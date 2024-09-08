/**
 * Travel plugin's front end code
 *
 * @module Travel
 * @class Travel
 */

(function (Q, $, w) {

	var Users = Q.Users;
	var Streams = Q.Streams;
	var Places = Q.Places;

	var Travel = Q.Travel = Q.plugins.Travel = {};

	Q.text.Travel = {};

	Q.Tool.define({
		"Travel/trips": "{{Travel}}/js/tools/trips.js",
		"Travel/trip": "{{Travel}}/js/tools/trip.js",
		"Travel/trip/preview": "{{Travel}}/js/tools/trip/preview.js",
		"Travel/trip/related": "{{Travel}}/js/tools/trip/related.js",
		"Travel/participants": "{{Travel}}/js/tools/travel/participants.js",
		"Travel/map": "{{Travel}}/js/tools/map.js",
		"Travel/navigation": "{{Travel}}/js/tools/navigation.js"
	});

	/**
	 * Travel Streams
	 * @module Travel-streams
	 * @main
	 */
	/**
	 * A Travel/trip stream
	 * @class Travel trip
	 * @constructor
	 * @param {Object} [fields] The fields of the stream
	 */
	Streams.define('Travel/trip', function (fields) {
		var stream = this;
		stream.fields.directions = fields.directions;
		stream.fields.coordinates = fields.coordinates;

		stream.onFieldChanged('coordinates').set(function (fields) {
			var coordinates1 = this.getAllCoordinates();
			var coordinates2 = JSON.parse(fields.coordinates);
			var changed = {};
			for (var userId in coordinates2) {
				var c1 = coordinates1[userId];
				var c2 = coordinates2[userId];
				if (!c1 || c1.latitude !== c2.latitude
					|| c1.longitude !== c2.longitude
					|| c1.heading !== c2.heading
					|| c1.speed !== c2.speed) {
					changed[userId] = coordinates2[userId];
				}
			}
			if (!Q.isEmpty(changed)) {
				Q.handle(Travel.Trip.onCoordinates(
					this.fields.publisherId, this.fields.name
				), this, [changed, c1, c2]);
			}
		}, 'Travel/trip');

		// on trip state changed
		stream.onAttribute('state').set(function (attributes, k) {
			Q.handle(Travel.Trip.onTripState, this, [attributes[k]]);

			if(attributes[k] === "ended"){
				Q.handle(Travel.Trip.onCancel, this);
			}
		}, 'Travel/trip');

		stream.onFieldChanged('directions').set(function (fields) {
			Q.handle(Travel.Trip.onRoute, this, [fields]);
		}, 'Travel/trip');

		stream.onAttribute('startTime').set(function (attributes, k) {
			Q.handle(Travel.Trip.onStartTime, this, [attributes, k]);
		}, 'Travel/trip');

		stream.onAttribute('endTime').set(function (attributes, k) {
			Q.handle(Travel.Trip.onEndTime, this, [attributes, k]);
		}, 'Travel/trip');

		// user state changed
		stream.onMessage('Travel/trip/user/state').set(function (message) {
			Q.handle(Travel.Trip.onUserState, Travel.Trip, [message]);
		}, 'Travel/trip');

		// user join trip
		stream.onMessage('Streams/joined').set(function (message) {
			Q.handle(Travel.Trip.onUserJoin, Travel.Trip, [message]);
		}, 'Travel/trip');

		// user leave trip
		stream.onMessage('Streams/leave').set(function (message) {
			Q.handle(Travel.Trip.onUserLeave, Travel.Trip, [message]);
		}, 'Travel/trip');

		// driver close to passenger
		stream.onMessage('Travel/trip/arriving').set(function (message) {
			Q.handle(Travel.Trip.onPassengerArriving, Travel.Trip, [message]);
		}, 'Travel/trip');

		// driver close to trip finish
		stream.onMessage('Travel/trip/finishing').set(function (message) {
			Q.handle(Travel.Trip.onFinishArriving, Travel.Trip, [message]);
		}, 'Travel/trip');

		// user received a message from chat
		stream.onMessage('Streams/chat/message').set(function (message) {
			Q.handle(Travel.Trip.onChatMessage, Travel.Trip, [message]);
		}, 'Travel/trip');
	}, {

		/**
		 * @method getAllCoordinates
		 * @return {Object} Contains {userId: coordinates} pairs
		 */
		getAllCoordinates: function () {
			return JSON.parse(this.fields.coordinates || '{}');
		},
		/**
		 * @method getCoordinates
		 * @param {String|Object} userId The id of a participant in the trip
		 * @return {Object|null} The coordinates of the user set in the trip
		 */
		getCoordinates: function (userId) {
			var coordinates = this.getAllCoordinates();
			return coordinates[userId];
		},
		/**
		 * @method setCoordinates
		 * @param {String|Object} userId The id of a user, or an array of userId: value pairs
		 * @param {Object} value The coordinates of the driver or the passenger pickup point
		 * @param {Number} value.latitude
		 * @param {Number} value.longitude
		 * @param {Number} value.heading
		 */
		setCoordinates: function (userId, value) {
			var coordinates = this.getAllCoordinates();
			coordinates[userId] = value;
			this.fields.coordinates = JSON.stringify(coordinates);
		},
		/**
		 * @method setUserState
		 * @param {String|Object} userId The id of a user
		 * @param {Function} callback
		 */
		getUserState: function (userId, callback) {
			Travel.Trip.getUserState(
				this.fields.publisherId,
				this.fields.name,
				userId, callback
			);
		},
		/**
		 * @method clearCoordinates
		 * @param {String} userId The name of the cordinates to remove
		 */
		clearCoordinates: function (userId) {
			var coordinates = this.getAllCoordinates();
			delete coordinates[userId];
			this.coordinates = JSON.stringify(coordinates);
		},
		/**
		 * Gets a route from the directions in the stream, if any.
		 * @param {Number} [index=0] Which route to return
		 * @return {Object|null}
		 */
		getRoute: function (index) {
			var directions = this.fields.directions && JSON.parse(this.fields.directions);
			return Q.getObject(['routes', index || 0], directions) || null;
		},

		/**
		 * Start driving in a trip
		 * @method start
		 * @param {Object} coordinates The coordinates of the pickup point
		 * @param {Number} coordinates.latitude
		 * @param {Number} coordinates.longitude
		 * @param {String} [coordinates.address] Additional address information may be useful
		 * @param {Function} [callback] callback
		 */
		start: function (coordinates, callback) {
			return Travel.Trip.start(
				this.fields.publisherId,
				this.fields.name,
				coordinates, callback
			);
		},
		/**
		 * Join some trip as a passenger
		 * @method join
		 * @param {String} userId The passenger's user id
		 * @param {Object} coordinates The coordinates of the pickup point
		 * @param {Number} coordinates.latitude
		 * @param {Number} coordinates.longitude
		 * @param {String} [coordinates.address] Additional address information may be useful
		 * @param {Function} [callback] callback
		 */
		join: function (userId, coordinates, callback) {
			return Travel.Trip.join(
				this.fields.publisherId,
				this.fields.name,
				userId, coordinates, callback
			);
		},
		/**
		 * Leave trip
		 * @method leave
		 * @param {String} userId The passenger's user id
		 * @param {Function} [callback] callback
		 */
		leave: function (userId, callback) {
			return Travel.Trip.leave(
				this.fields.publisherId,
				this.fields.name,
				userId, callback
			);
		},
		/**
		 * Update the coordinates, heading, speed etc. of a driver or passenger in a trip
		 * @method coordinates
		 * @param {String} userId The user id of a driver or passenger
		 * @param {Object} coordinates The coordinates of the pickup point
		 * @param {Number} coordinates.latitude
		 * @param {Number} coordinates.longitude
		 * @param {Number} [coordinates.heading]
		 * @param {Number} [coordinates.speed]
		 * @param {String} [coordinates.address] Additional address information may be useful
		 * @param {Function} [callback] callback
		 */
		coordinates: function (userId, coordinates, callback) {
			return Travel.Trip.coordinates(
				this.fields.publisherId,
				this.fields.name,
				userId, coordinates, callback
			);
		},
		/**
		 * Drivers can call this to indicate they've picked up a passenger.
		 * A passenger can call this to indicate they've been picked up.
		 * Pickups can automatically happen as well, if the plugin automatically
		 * determines a user has been picked up.
		 * @method state
		 * @param {String} userId The passenger's user id
		 * @param {String} state The passenger's new state
		 * @param {Function} [callback] callback
		 */
		state: function (userId, state, callback) {
			return Travel.Trip.state(
				this.fields.publisherId,
				this.fields.name,
				userId, state, callback
			);
		},
		/**
		 * Discontinue the trip, as a driver
		 * @method discontinue
		 */
		discontinue: function (callback) {
			return Travel.Trip.discontinue(
				this.fields.publisherId,
				this.fields.name,
				callback
			);
		},
		/**
		 * Complete the trip, as a driver
		 * @method complete
		 */
		complete: function (callback) {
			return Travel.Trip.complete(
				this.fields.publisherId,
				this.fields.name,
				callback
			);
		}
	});

	/**
	 * A trip taken by a driver and some passengers
	 * @class Trip
	 */
	Travel.Trip = function () {

	};

	// key for passenger location to store in localStorage
	Travel.Trip.passengerLocation = "Q.Travel.Trip.passengerLocation";

	var _onCoordinates = {};

	/**
	 * Returns Q.Event that occurs when the coordinates of one or more participants
	 * in a trip have changed.
	 * @event onCoordinates
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @return {Q.Event}
	 */
	Travel.Trip.onCoordinates = Q.Event.factory(_onCoordinates, ["", ""]);

	/**
	 * Returns Q.Event that occurs when the trip start time changed.
	 * @event onStartTime
	 * @return {Q.Event}
	 */
	Travel.Trip.onStartTime = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the trip end time changed.
	 * @event onEndTime
	 * @return {Q.Event}
	 */
	Travel.Trip.onEndTime = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the trip route changed.
	 * @event onRoute
	 * @return {Q.Event}
	 */
	Travel.Trip.onRoute = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the trip state changed.
	 * @event onTripState
	 * @return {Q.Event}
	 */
	Travel.Trip.onTripState = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the user state changed.
	 * @event onUserState
	 * @return {Q.Event}
	 */
	Travel.Trip.onUserState = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the user join trip.
	 * @event onUserJoin
	 * @return {Q.Event}
	 */
	Travel.Trip.onUserJoin = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the user leave trip.
	 * @event onUserLeave
	 * @return {Q.Event}
	 */
	Travel.Trip.onUserLeave = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the trip discontinued.
	 * @event onCancel
	 * @return {Q.Event}
	 */
	Travel.Trip.onCancel = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the driver close to passenger.
	 * @event onPassengerArriving
	 * @return {Q.Event}
	 */
	Travel.Trip.onPassengerArriving = new Q.Event();

	/**
	 * Returns Q.Event that occurs when the driver close to trip finish.
	 * @event onFinishArriving
	 * @return {Q.Event}
	 */
	Travel.Trip.onFinishArriving = new Q.Event();

	/**
	 * Returns Q.Event that occurs when user receive a message from chat
	 * @event onChatMessage
	 * @return {Q.Event}
	 */
	Travel.Trip.onChatMessage = new Q.Event();

	/**
	 * Create a new trip, as a driver
	 * @method create
	 * @static
	 * @param {String} type The type of the trip, should be be "Travel/from" or "Travel/to"
	 * @param {Object} from The starting location of the trip
	 * @param {Number} from.latitude
	 * @param {Number} from.longitude
	 * @param {String} from.placeId Can be used instead of latitude and longitude
	 * @param {Object} to The destination of the trip
	 * @param {Number} to.latitude
	 * @param {Number} to.longitude
	 * @param {String} to.placeId Can be used instead of latitude and longitude
	 * @param {String} to.venue The name of the venue at the destination
	 * @param {Number} to.peopleMax Required. Max amount of people the car can fit, including driver
	 * @param {Function} callback
	 * @param {Object} options
	 * @param {boolean} [options.offerFromToo] Boolean flag indicate if driver offers "from" trip also. Please set "departTime" option in this case.
	 * @param {Object} options.relateTo
	 * @param {String} options.relateTo.publisherId
	 * @param {String} options.relateTo.streamName
	 * @param {Integer} options.arriveTime Unix timestamp. Time when "to" trip should arrive.
	 * @param {Integer} [options.departTime] Unix timestamp. Time when "from" trip should start.
	 * @param {Integer} [options.detourMax] Maximum minutes driver can spend driving to pick up passengers.
	 * @param {String|Array} [options.labels] Labels of the users who can see the trip. If specified, the trip is not accessible to the public.
	 */
	Travel.Trip.create = function (type, from, to, callback, options) {
		var fields = {
			type: type,
			from: from,
			to: to
		};
		Q.extend(fields, options);
		Q.req('Travel/trip', ['stream', 'participant'], function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};
	/**
	 * Callback replacement function to call after each request
	 * It refresh all participated streams and execute callback defined in arguments of caller.
	 * Need to work without node
	 * @method refreshStreams
	 * @static
	 */
	Travel.Trip.refreshStreams = function(){
			var context = this;
			var args = Array.prototype.slice.call(arguments);
			var callback = args.pop();
			Streams.refresh(function(){
				Q.handle(callback, context, args);
			}, {
				messages: true,
				unlessSocket: true
			});
	};
	/**
	 * Subscribe user to some direction
	 * @method subscribe
	 * @static
	 * @param {String} type The type of the trip, should be be "Travel/from" or "Travel/to"
	 * @param {Object} location Location to which user want to subscribe
	 * @param {Number} location.latitude
	 * @param {Number} location.longitude
	 * @param {String} location.placeId Can be used instead of latitude and longitude
	 * @param {string} url Current page url
	 * @param {Function} callback
	 */
	Travel.Trip.subscribe = function (type, location, callback) {
		var fields = {
			type: type,
			location: location
		};
		Q.req('Travel/subscribe', [], function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};
	/**
	 * UnSubscribe user from some direction
	 * @method unsubscribe
	 * @static
	 * @param {String} type The type of the trip, should be be "Travel/from" or "Travel/to"
	 * @param {Object} location Location to which user want to subscribe
	 * @param {Number} location.latitude
	 * @param {Number} location.longitude
	 * @param {String} location.placeId Can be used instead of latitude and longitude
	 * @param {Function} callback
	 */
	Travel.Trip.unsubscribe = function (type, location, callback) {
		var fields = {
			type: type,
			location: location
		};
		Q.req('Travel/unsubscribe', [], function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};
	/**
	 * Start driving in a trip
	 * @method start
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {Object} coordinates The coordinates of the pickup point
	 * @param {Number} coordinates.latitude
	 * @param {Number} coordinates.longitude
	 * @param {String} [coordinates.address] Additional address information may be useful
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.start = function (publisherId, streamName, coordinates, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName,
			coordinates: coordinates
		};
		Q.req('Travel/start', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};

	/**
	 * Join some trip as a passenger
	 * @method join
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {String} userId The passenger's user id
	 * @param {Object} coordinates The coordinates of the pickup point
	 * @param {Number} coordinates.latitude
	 * @param {Number} coordinates.longitude
	 * @param {String} [coordinates.address] Additional address information may be useful
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.join = function (publisherId, streamName, userId, coordinates, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName,
			coordinates: coordinates,
			userId: userId
		};
		Q.req('Travel/join', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};

	/**
	 * Leave some trip as a passenger
	 * @method leave
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {String} userId The passenger's user id
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.leave = function (publisherId, streamName, userId, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName,
			userId: userId
		};
		Q.req('Travel/leave', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};

	/**
	 * Update the coordinates, heading, speed etc. of a driver or passenger in a trip
	 * @method coordinates
	 * @param {String} publisherId Trip stream publisherId (driver)
	 * @param {String} streamName Trip stream name
	 * @param {String} userId The user id of a driver or passenger
	 * @param {Object} coordinates The coordinates of the pickup point
	 * @param {Number} coordinates.latitude
	 * @param {Number} coordinates.longitude
	 * @param {Number} [coordinates.heading]
	 * @param {Number} [coordinates.speed]
	 * @param {String} [coordinates.address] Additional address information may be useful
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.coordinates = function (publisherId, streamName, userId, coordinates, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName,
			coordinates: coordinates,
			userId: userId
		};
		Q.req('Travel/coordinates', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};

	/**
	 * Drivers can call this to indicate they've picked up a passenger.
	 * A passenger can call this to indicate they've been picked up.
	 * Pickups can automatically happen as well, if the plugin automatically
	 * determines a user has been picked up.
	 * @method state
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {String} userId The passenger's user id
	 * @param {String} state The passenger's new state
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.state = function (publisherId, streamName, userId, state, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName,
			userId: userId,
			state: state
		};
		Q.req('Travel/state', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};

	/**
	 * Discontinue the trip, as a driver
	 * @method discontinue
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.discontinue = function (publisherId, streamName, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName
		};
		Q.req('Travel/discontinue', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};
	/**
	 * Complete the trip, as a driver
	 * @method complete
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.complete = function (publisherId, streamName, callback) {
		var fields = {
			publisherId: publisherId,
			streamName: streamName
		};
		Q.req('Travel/complete', 'stream', function(){
			// last argumant always should be callback
			var args = Array.prototype.slice.call(arguments);
			args.push(callback);
			Q.handle(Travel.Trip.refreshStreams, this, args);
		}, {
			method: 'post',
			fields: fields
		});
	};
	/**
	 * Get user state
	 * @method getUserState
	 * @static
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {String} userId
	 * @param {Function} [callback] callback
	 */
	Travel.Trip.getUserState = function(publisherId, streamName, userId, callback) {
		Streams.get(publisherId, streamName, function (err, tripStream, extra) {
			var fem = Q.firstErrorMessage(err);
			if (fem) {
				return console.warn("Travel.Trip.getUserState: " + fem);
			}

			var userState = null;

			extra.participants = extra.participants || [];
			Q.each(extra.participants, function (index, participant) {
				if (participant.state !== 'participating') {
					return;
				}

				// filter by user id
				if(index !== userId){
					return;
				}

				var extra = participant.extra ? JSON.parse(participant.extra) : null;

				userState = Q.isPlainObject(extra) ? extra.state : null;

				Q.handle(callback, this, [userState, extra.timestamp]);
			}, {sort: 'insertedTime', ascending: false});
		}, {participants: 100});
	};

	/**
	 * Register current device to make possible send notifications later
	 * @method registerDevice
	 * @static
	 */
	Travel.Trip.registerDevice = function(){
		// register users device if it didn't registered yet
		Users.Device.subscribe(function(err, subscribed){
			var fem = Q.firstErrorMessage(err);
			if (fem) {
				console.error("Device registration: " + fem);
				return false;
			}

			if(subscribed) {
				console.log("device subscribed");
			} else {
				console.log("device Subscription fail!!!");
			}
		});
	};
	
	Q.Users.onLogout.set(function () {
		localStorage.removeItem(Q.Travel.Trip.passengerLocation);
	}, 'Travel');

	/**
	 * Register current device to make possible send notifications later
	 * @method registerDevice
	 * @static
	 */
	Travel.Trip.unRegisterDevice = function(){
		// unregister users device
		Users.Device.unsubscribe(function(err){
			var fem = Q.firstErrorMessage(err);
			if (fem) {
				console.error("Device unregistration: " + fem);
				return false;
			}

			console.log("device unsubscribed");
		});
	}
})(Q, Q.jQuery, window);