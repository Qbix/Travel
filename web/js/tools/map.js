(function (Q, $, window, undefined) {

var Users = Q.Users;
var Streams = Q.Streams;
var Places = Q.Places;
var Travel = Q.Travel;

/**
 * Travel Tools
 * @module Travel-tools
 * @main
 */

/**
 * Used to manage locations, waypoints on a map. For each of the below parameters
 * of type Places.Coordinates, it can be anything that can be passed to
 * Places.Coordinates.from() method.
 * @class Travel map
 * @constructor
 * @param {Object} [options]
 *   @param {Places.Coordinates} options.center Required. Where to center the map
 *   @param {Integer} [options.zoom=12] Initial zoom level of the map
 *   @param {Object} [options.avatarOptions] Default options to provide to Users/avatar tool
 *   @param {Object} [options.avatars] Pairs of {userId: info} where the info has
 *     properties of Places.Coordinates, and possible "avatar" for Users/avatar tool options
 *   @param {Places.Coordinates} [options.from] Start coordinates
 *   @param {Places.Coordinates} [options.to] End coordinates
 *   @param {Number} [options.startTime] Time to start trip. Standard Unix time (seconds from 1970). If set, do not set startTime.
 *   @param {Number} [options.endTime] Time to end trip. Standard Unix time (seconds from 1970). If set, do not set endTime.
 *   @param {DirectionsResult} [options.directions] A saved result from a previous call to the routing service
 *   @param {Array} options.waypoints Array of waypoints (each is a Places.Coordinates)
 *   @param {Q.Event} options.onMap occurs when the map is loaded
 *   @param {Q.Event} options.onAvatarsAdded Q.event execute when all avatars added on map
 *   @param {Q.Event} options.onRouteCreated Q.event execute when route added on map
 *   @param {Object} [options.platform=Places.options.platform]
 */
Q.Tool.define("Travel/map", function (options) {
	var tool = this;
	var state = this.state;
	if (options.platform !== 'google') {
		throw new Q.Error("Travel/map only works with platform=google for now");
	}
	if (!state.center) {
		throw new Q.Error("Travel/map: please specify the center of the map");
	}
	state.from = state.from || state.driver;
	var pipe = Q.pipe(['styles', 'scripts'], tool.refresh.bind(tool));
	tool.markers = {};
	tool.$avatars = {};
	Q.addStylesheet('{{Travel}}/css/map.css', pipe.fill("styles"), { slotName: 'Travel' });
	Places.loadGoogleMaps(function () {
		Q.addScript('{{Travel}}/js/richmarker.js', pipe.fill("scripts"))
	});
	tool.rendering('avatars', function () {
		tool.renderAvatars();
		tool.renderRoute();
	});
	tool.rendering(['from', 'to', 'waypoints'], function () {
		tool.renderRoute();
	});

	// on tool element height changed - trigger google map resize
	Q.onLayout(tool.element).set(function () {
		if (!state.googleMap) {
			return;
		}

		google.maps.event.trigger(state.googleMap, 'resize');
	}, tool);


},

{
	platform: Places.options.platform,
	avatarOptions: {icon: 40, short: true, reflectChanges: false},
	avatars: {},
	from: null,
	to: null,
	center: null,
	zoom: 12,
	startTime: null,
	endTime: null,
	waypoints: [],
	templates: {
		map: {
			name: 'Travel/map',
			fields: {}
		}
	},
	mapEvents: [
		'bounds_changed',
		'center_changed',
		'click',
		'dblclick',
		'drag',
		'dragend',
		'dragstart',
		'heading_changed',
		'idle',
		'maptypeid_changed',
		'mousemove',
		'mouseout',
		'mouseover',
		'projection_changed',
		'resize',
		'rightclick',
		'tilesloaded',
		'tilt_changed',
		'zoom_changed'
	],
	onRefresh: new Q.Event(),
    onMap: new Q.Event(),
	onAvatarsAdded: new Q.Event(),
	onRouteCreated: new Q.Event(),
	onMapEvent: Q.Event.factory()
},

{
	/**
	 * Refresh the display
	 * @method refresh
	 * @param {Function} callback
	 */
	refresh: function (callback) {
		var tool = this;
		var $te = $(tool.element);
		var state = tool.state;

		Q.Tool.clear(tool.element);

		Places.Coordinates.from(state.center, function (err) {
			if (err) {
                return console.warn(err);
			}

			state.googleMap = new google.maps.Map(tool.element, {
				zoom: state.zoom,
				center: _position(this),
				mapTypeControl: false
			});

            Q.handle(state.onMap, tool, arguments);

			Q.each(state.mapEvents, function (index, eventName) {
				state.googleMap.addListener(eventName, function() {
					Q.handle(state.onMapEvent(eventName), state.googleMap);
				});
			});

			state.directionsRenderer = null;
			var pipe = new Q.Pipe(['avatars', 'route'], function () {
				Q.handle(callback, tool, arguments);
				Q.handle(state.onRefresh, tool, arguments);
			});
			tool.renderAvatars(pipe.fill('avatars'));
			tool.renderRoute(pipe.fill('route'));
		});
	},
	/**
	 * Change map zoom to area with only some points.
	 * @method resumeZoomToDestination
	 * @param {array} points Array of points need to be zoomed on map
	 */
	resumeZoomToDestination: function (points) {
		var map = this.state.googleMap;

		if (!map) {
			return;
		}

		var bounds = new google.maps.LatLngBounds();
		for (var i = 0; i < points.length; i++) {
			bounds.extend(_position(points[i]));
		}

		map.fitBounds(bounds);
	},
	/**
	 * Renders the route. If state.directions is not set, then
	 * makes a request to the routing service of the platform.
	 * @method renderRoute
	 * @param {object} params
	 * @param {bool} [params.suppressMarkers] whether suppress way points markers or not (false by default)
	 * @param {Function} callback
	 */
	renderRoute: function (params, callback) {
		var tool = this;
		var state = tool.state;

		// if params omitted, try implement it as callback
		if(typeof callback !== "function" && typeof params === "function") {
			callback = params;
		}

		if (state.directions) {
			_typecastRoutes(state.directions.routes);
			_display(state.directions);
			return;
		}
		if (!state.from || !state.to) {
			// run callback even if no route on the map
			Q.handle(callback, tool);
			return;
		}
		var waypoints = [];
		var from = _position(state.from);
		Q.each(state.waypoints, function (i, s) {
			waypoints.push({
				location: _position(s)
			});
		});
		var to = _position(state.to);
		if (state.directions) {
			_display(state.directions);
		} else {
			Places.route(from, to, waypoints, true, function (directions, status) {
				_display(directions);
			}, state);
		}
		function _display(directions) {
			var options = {};

			if (typeof params === "object") {
				for(var param in params){
					options[param] = !!Q.getObject(param, params);
				}
			}

			if (!state.directionsRenderer) {
				state.directionsRenderer = new google.maps.DirectionsRenderer();
				state.directionsRenderer.setMap(state.googleMap);
			}
			state.directionsRenderer.setOptions(options)
			state.directionsRenderer.setDirections(directions);
			state.directions = directions;

			Q.handle(state.onRouteCreated, tool);
			Q.handle(callback, tool);
		}
	},
	
	/**
	 * Remove all avatars from map and add again using state.avatars
	 * @method renderAvatars
	 * @param {Function} callback
	 */
	renderAvatars: function (callback) {
		var tool = this;
		var state = this.state;
		var marker, avatar;

		// remove all markers first
		for (userId in tool.markers) {
			if (!tool.markers.hasOwnProperty(userId)) continue;
			if (typeof tool.markers[userId] !== 'object') continue;
			marker = tool.markers[userId];
			if (typeof marker.onRemove === "function") {
				marker.onRemove(); // for rich marker
			}
			if (typeof marker.setMap === "function") {
				marker.setMap(null); // for standard google markers
			}
			if (marker.avatarTool) {
				marker.avatarTool.remove(true, true);
			}
		}
		tool.markers = {};
		tool.$avatars = {};
		var i = 0;
		var waitFor = Object.keys(state.avatars);
		var pipe = new Q.Pipe(waitFor, function(){
			Q.handle(state.onAvatarsAdded, tool);
			Q.handle(callback, tool);
		});
		for (var userId in state.avatars) {
			avatar = state.avatars[userId];
			Places.Coordinates.from(avatar, function (err) {
				var pos = Q.take(this, ['latitude', 'longitude', 'heading']);
				if (err) {
					return console.warn(err);
				}
				// cache results of geocoding for next time
				avatar.latitude = pos.latitude;
				avatar.longitude = pos.longitude;
				avatar.heading = pos.heading;
				tool.addAvatar(userId, avatar, pipe.fill(userId));
			});
		}
	},
	
	/**
	 * Add a user avatar tool on the map
	 * @method addAvatar
	 * @param {Object} user Object in format {userId: "..."}
	 * @param {Places.Coordinates} coordinates
	 * @param {Function} callback
	 */
	addAvatar: function (userId, coordinates, callback) {
		var tool = this;
		var state = tool.state;
		var toolId = "Users_avatar_" + userId;
		if (Q.isEmpty(coordinates)) {
			Places.Coordinates.from({userId: userId}, _add);
		} else {
			Places.Coordinates.from(coordinates, _add);
		}
		
		function _add(err) {
			if (err) {
				return console.warn(err);
			}
			if (tool.$avatars[userId]) {
				// this avatar was already added
				return;
			}
			var that = this;
			var position = _position(this);
			var $te = $(tool.element);
			var o = Q.extend({userId: userId},
				state.avatarOptions,
				coordinates && coordinates.avatar
			);

			// for cases when this method launch outside
			// check whether this avatar exist in state
			// and add if not
			if(Q.isEmpty(state.avatars[userId])){
				state.avatars[userId] = coordinates;
			}

			tool.$avatars[userId] = $('<div>')
			.appendTo($te)
			.tool('Users/avatar', o, toolId, tool.prefix)
			.activate(function () {
				var avatar = this;
				var marker = new RichMarker({
					map: state.googleMap,
					position: position,
					draggable: false,
					flat: true,
					anchor: RichMarkerPosition.MIDDLE,
					content: this.element
				});
				
				if (that.heading) {
					marker.content.style.transform =
					marker.content.style[Q.info.browser.prefix+'transform'] = 
					'rotate(' + that.heading + 'deg)';
				}

				// add marker to global array
				tool.markers[userId] = marker;
				marker.avatarTool = this;

				// sometimes we have to update the marker's position for it to stick
				setTimeout(function () {
					marker.position_changed();
				}, 1000);
				
				Q.handle(callback, tool, [avatar, that]);
			});
			
			if (this.onUpdated) {
				this.onUpdated.set(function () {
					tool.moveAvatar(userId, this);
				}, tool);
			}
		}
	},
	
	/**
	 * Change avatar position on the map
	 * @method moveAvatar
	 * @param {String} userId
	 * @param {Object} coordinates Pass whatever changed
	 * @param {Number} [coordinates.latitude]
	 * @param {Number} [coordinates.longitude]
	 * @param {Number} [coordinates.heading]
	 */
	moveAvatar: function (userId, coordinates) {
		var avatar = this.state.avatars[userId];
		var original = Q.take(avatar, ['latitude', 'longitude', 'heading']);
		coordinates = Q.extend({}, avatar, coordinates);
		var marker = this.markers[userId];
		if (!marker) {
			console.warn("Travel/map: moveAvatar found no marker for " + userId);
			return;
		}
		marker.position = _position(coordinates);
		marker.position_changed();
		if ('heading' in coordinates) {
			marker.content.style.transform =
			marker.content.style[Q.info.browser.prefix+'transform'] = 
			'rotate(' + coordinates.heading + 'deg)';
			Q.extend(avatar, coordinates);
		}
	},
	/**
	 * remove avatar from map
	 * @method removeAvatar
	 * @param {String} userId
	 */
	removeAvatar: function (userId) {
		var marker = this.markers[userId];
		if (!marker) {
			console.warn("Travel/map: removeAvatar found no marker for " + userId);
			return;
		}
		marker.avatarTool.remove(true, true);
		marker.onRemove();

		// also remove fromstate and markers
		delete this.$avatars[userId];
		delete this.state.avatars[userId];
		delete this.markers[userId];
	},
	Q: {
		beforeRemove: function () {
			// remove all child tools
			var children = this.children('', 1);
			for (var id in children) {
				for (var n in children[id]) {
					children[id][n].remove(true, true);
				}
			}
		}
	}
});

function _position(loc) {
	return (loc.latitude && loc.longitude)
		? new google.maps.LatLng(
			parseFloat(loc.latitude),
			parseFloat(loc.longitude)
		) : loc;
}

function _typecastRoutes(routes){
    Q.each(routes, function(i, route) {
        route.bounds = _asBounds(route.bounds);
        // I don't think `overview_path` is used but it exists on the
        // response of DirectionsService.route()
        route.overview_path = _asPath(route.overview_polyline);
        Q.each(route.legs, function(i, leg){
            leg.start_location = _asLatLng(leg.start_location);
            leg.end_location   = _asLatLng(leg.end_location);
            Q.each(leg.steps, function(i, step){
                step.start_location = _asLatLng(step.start_location);
                step.end_location   = _asLatLng(step.end_location);
                step.path = _asPath(step.polyline);
            });

        });
    });
}

function _asBounds(boundsObject){
    return new google.maps.LatLngBounds(_asLatLng(boundsObject.southwest),
                                   _asLatLng(boundsObject.northeast));
}

function _asLatLng(latLngObject){
    return new google.maps.LatLng(latLngObject.lat, latLngObject.lng);
}

function _asPath(encodedPolyObject){
    return google.maps.geometry.encoding.decodePath( encodedPolyObject.points );
}

})(Q, Q.jQuery, window);