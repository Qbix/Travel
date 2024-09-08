(function (Q, $, window, undefined) {

	var Users = Q.Users;
	var Streams = Q.Streams;
	var Places = Q.Places;
	var Travel = Q.Travel;
	var Calendars = Q.Calendars;

	/**
	 * Travel Tools
	 * @module Travel-tools
	 * @main
	 */

	/**
	 * Renders a full trip interface, with a map and controls.
	 * @class Travel trip
	 * @constructor
	 * @param {Object} [options]
	 *   @param {String} options.publisherId Publisher of the trip stream (for player mode)
	 *   @param {String} options.streamName Name of the trip stream (for player mode)
	 *   @param {String} [options.showWhenRiding=false] If false - don't show picked up passenger on map
	 *   @param {String} [options.trackPassengers=false] If false - don't track passengers location and show button "Pickup Location"
	 *   when trip started. If true - track passengers location during trip and hide button "Pickup Location"
	 *   when trip started.
	 *   zoomMethod: "toCenter", // can be toCenter, toDestination
	 *   @param {String} [options.zoomMethod=zoomToCenter] Method to zoom map. Can be:
	 *   	zoomToCenter: map always centered to current user position.
	 *   	zoomToDestination: zoom to fit route between driver and next destination point
	 *   @param {String} options.tripState Current trip state
	 *   @param {String} options.isDriver Whether current user is a driver
	 *   @param {String} options.currentUserId Current user id
	 *   @param {String} [option.useNavigation=true] Allow to avoid from navigation. If false - don't use navigation tool
	 *   @param {Object} options.animation Animation options applied to users avatar moving on map
	 *   @param {Number}    options.animation.duration
	 *   @param {Function}    options.animation.ease
	 *   @param {Number} geoLocationUpdateInterval Seconds interval which user location will check
	 *   @param {Q.Event} options.onFinish Event triggered when trip finish (cancelled or complete)
	 */
	Q.Tool.define("Travel/trip", function (options) {
			var tool = this;
			var state = this.state;

			// set text
			Q.Text.get("Travel/content", function(err, result){
				var msg = Q.firstErrorMessage(err);
				if (msg) {
					throw new Q.Error(msg);
				}

				state.text = result;
			});

			// set current user id to state so it accessible from any method
			state.currentUserId = Users.loggedInUserId();

			// whether current user flag
			state.isDriver = (state.currentUserId === state.publisherId);

			if (!state.isDriver) {
				state.zoomMethod = "zoomToDriver";
			}

			if (!state.publisherId) {
				throw new Q.Error("Travel/trip: publisherId option is required");
			}

			if (!state.streamName) {
				throw new Q.Error("Travel/trip: streamName option is required");
			}

			// distances constants from config
			state.distances = Q.plugins.Travel.Trip.distances;

			// support cordova-background-geolocation plugin
			Q.addEventListener(document, 'deviceready', function () {
				console.log("Device ready");

				// check if backgroundLocationServices plugin loaded
				if (!window.plugins || !window.plugins.backgroundLocationServices) return;

				var backgroundGeolocation = window.plugins.backgroundLocationServices;

				//Congfigure Plugin
				backgroundGeolocation.configure({
					//Both
					desiredAccuracy: 1,
					distanceFilter: 1,
					debug: false, // <-- Enable to show visual indications when you receive a background location update
					interval: 1000, // (Milliseconds) Requested Interval in between location updates.
					useActivityDetection: true, // Uses Activitiy detection to shut off gps when you are still (Greatly enhances Battery Life)

					//Android Only
					notificationTitle: 'BG Plugin', // customize the title of the notification
					notificationText: 'Tracking', //customize the text of the notification
					fastestInterval: 1000 // <-- (Milliseconds) Fastest interval your app / server can handle updates

				});

				//Register a callback for location updates, this is where location objects will be sent in the background
				backgroundGeolocation.registerForLocationUpdates(function (location) {
					tool.updateLocation({"coords": location});
				}, function (err) {
					console.log("backgroundGeolocation Error: Didnt get an update", err);
				});

				state.backgroundGeolocation = backgroundGeolocation;
			}, false);

			tool.refresh();
		},

		{
			publisherId: null,
			streamName: null,
			geoLocationUpdateTimerId: null,
			geoLocationUpdateInterval: 3, // seconds
			useNavigation: true,
			showWhenRiding: false,
			trackPassengers: false,
			zoomMethod: "zoomToCenter", // can be zoomToCenter, zoomToDestination
			mapCustomized: false,
			tripState: "new",
			isDriver: false,
			currentUserId: null,
			maxPickupLocationChangeMeters: null,
			test: {},
			intervalIds: {},
			animation: {
				duration: 1000,
				ease: Q.Animation.ease.smooth
			},
			onFinish: new Q.Event(function () {
				if (this.removed) {
					return;
				}

				// remove navigation tool
				if (this.state.navigation) {
					this.state.navigation.remove(true, true);
				}

				// remove trip tool
				this.remove(true, true);
			})
		},

		{
			/**
			 * Refreshes the tool's display
			 */
			refresh: function () {
				var tool = this;
				var state = tool.state;
				var $te = $(tool.element);
				var map = null;
				var navigation = null;

				// Test button handler
				$te.on(Q.Pointer.fastclick, "button[name=test]", function () {
					var currentUserId = state.currentUserId;
					var oldCoords = tool.map.state.avatars[currentUserId];

					var newCoords = {
						latitude: parseFloat(oldCoords.latitude),
						longitude: parseFloat(oldCoords.longitude),
						heading: 270
					};

					Travel.Trip.coordinates(state.publisherId, state.streamName, currentUserId, newCoords);
				});

				// Start Driving button handler
				$te.on(Q.Pointer.fastclick, "button[name=startDriving]", function () {
					var $this = $(this);

					// disable click events
					$this.addClass("Q_working");

					tool.getCurrentPosition(function (pos) {
						var coordinates = {
							latitude: parseFloat(pos.coords.latitude),
							longitude: parseFloat(pos.coords.longitude)
						};

						if (!tool.child('Travel_navigation', 'Travel/navigation') && state.useNavigation){
						// take needed options from custom map and render navigation
							$("<div>").appendTo(tool.element).tool("Travel/navigation", {
								center: {
									lat: pos.coords.latitude,
									lng: pos.coords.longitude
								},
								compass: true,
								reCenter: true,
								bottomMenu: true,
								fullScreen: true,
								tilt: 45,
								from: tool.map.state.from,
								to: tool.map.state.to,
								avatars: (tool.map.markers) ? tool.map.markers : null
							}).activate(function(){

								// remove old map
								tool.map.remove();

								navigation = state.navigation = this;
								map = tool.map = this.state.mapTool;

								// create information menu for full-screen
								// run navigation on full-screen mode
								tool.fullScreenMode();

								// start trip after navigation tool will be activated
								_startTrip();

								// set listener for new coordinates from navigation
								this.state.onNewCoordinates.add(function (coords, heading) {
									if(!coords) return;
									var newCoords = {};
									newCoords.latitude = coords.latitude || coords.lat();
									newCoords.longitude = coords.longitude || coords.lng();
									newCoords.heading = heading;
									Travel.Trip.coordinates(state.publisherId, state.streamName, state.currentUserId, newCoords);
								});
							});
						} else {
							_startTrip();
						}
						function _startTrip(){
							Travel.Trip.start(state.publisherId, state.streamName, coordinates, function (err, response) {
								// enable click event
								$this.removeClass("Q_working");

								var msg = Q.firstErrorMessage(err, response && response.errors);
								if (msg) {
									// enable click event
									$this.removeClass("Q_working");
									return Q.alert(msg);
								}
							});
						}
					}, function (err) {
						// enable click event
						$this.removeClass("Q_working");
						return Q.alert("Travel/trip: " + err.message);
					});
				});

				// pickMeUp button handler
				$te.on(Q.Pointer.fastclick, "button[name=pickMeUp]", function () {
					var loc = localStorage.getItem(Travel.Trip.passengerLocation);

					try {
						loc = JSON.parse(loc);
					} catch (ex) {
						Q.alert("Travel/trip: wrong passenger location format.");
						return;
					}

					if (Q.isEmpty(loc)){
						Q.Places.Dialogs.location(function (coordinates) {
							if (coordinates) {
								coordinates.geocode(function () {
									loc = Q.take(this, [
										'latitude', 'longitude', 'distance', 'placeId', 'venue'
									]);
									localStorage.setItem(
										Travel.Trip.passengerLocation,
										JSON.stringify(loc),
										{expires: 2592000000}
									);
									_continue();
								});
							}
						});
					} else {
						_continue();
					}
					
					function _continue () {
						loc.distance = tool.map.state.directions.routes[0].legs[0].distance.value;

						Travel.Trip.join(
						state.publisherId, state.streamName, state.currentUserId, loc, 
						function(err, response){
							var msg = Q.firstErrorMessage(err, response && response.errors);
							if (msg) {
								return Q.alert(msg);
							}
							// place user avatar on map
							tool.moveAvatar(state.currentUserId, loc);
						});
					}
				});

				// pickupLocation button handler
				$te.on(Q.Pointer.fastclick, "button[name=pickupLocation]", function () {
					Places.Dialogs.location(function (loc) {
						if (!loc) {
							return;
						}
						
						var newCoords = {};
						newCoords.latitude = loc.latitude || geocode.lat();
						newCoords.longitude = loc.longitude || geocode.lng();

						if (state.maxPickupLocationChangeMeters != null && state.tripState == "started") {
							var currentUserMarker = tool.map.markers[state.currentUserId];
							var currentCoords = {
								latitude: currentUserMarker.position.lat(),
								longitude: currentUserMarker.position.lng()
							};
							var distance = Places.distance(currentCoords.latitude, currentCoords.longitude, newCoords.latitude, newCoords.longitude);
							if (distance > state.maxPickupLocationChangeMeters) {
								return Q.alert("Maximum distance passed: " + state.maxPickupLocationChangeMeters);
							}
						}

						// set new coordinates for passenger
						Travel.Trip.coordinates(state.publisherId, state.streamName, state.currentUserId, newCoords);

						// place user avatar on map
						tool.moveAvatar(state.currentUserId, newCoords);

						// hide dialog when location selected
						Q.Dialogs.pop();
					});
				});

				// Trip cancelled button handler
				$te.on(Q.Pointer.fastclick, "button[name=tripCancel]", function () {
					var question = state.text.trip.AreYouSure + "<br>" + state.text.trip.CancellTripWarning;

					Q.confirm(question, function (res) {
						if (!res) return;

						Travel.Trip.discontinue(state.publisherId, state.streamName, function (err, response) {
							var msg = Q.firstErrorMessage(err, response && response.errors);
							if (msg) {
								return Q.alert(msg);
							}

							Q.handle(state.onFinish, tool);
						});
					}, {ok: state.text.trip.Yes, cancel: state.text.trip.No});

					return false;
				});

				// Trip complete button handler
				$te.on(Q.Pointer.fastclick, "button[name=tripComplete]", function () {
					var question = state.text.trip.AreYouSure;

					Q.confirm(question, function (res) {
						if (!res) return;

						Travel.Trip.complete(state.publisherId, state.streamName, function (err, response) {
							var msg = Q.firstErrorMessage(err, response && response.errors);
							if (msg) {
								return Q.alert(msg);
							}

							Q.handle(state.onFinish, tool);
						});
					}, {ok: state.text.trip.Yes, cancel: state.text.trip.No});

					return false;
				});

				// Trip refused by passenger
				$te.on(Q.Pointer.fastclick, "button[name=tripRefuse]", function () {
					Q.confirm(state.text.trip.AreYouSure, function (res) {
						if (!res) return;

						Travel.Trip.leave(state.publisherId, state.streamName, state.currentUserId, function (err, response) {
							var msg = Q.firstErrorMessage(err, response && response.errors);
							if (msg) {
								return Q.alert(msg);
							}
						});
					}, {ok: state.text.trip.Yes, cancel: state.text.trip.No});
				});

				Streams.retainWith(tool).get(state.publisherId, state.streamName, function (err, stream, extra) {
					stream = this;

					// if trip stream closed - exit
					if (!!stream.fields.closedTime) {
						Q.alert(state.text.trip.TripAlreadyClosed);
						tool.remove(false, true);
						return;
					}

					state.tripStream = stream;

					var participant = this.participant;
					state.participantState = (participant && participant.getExtra('state')) || (state.isDriver ? 'waiting' : 'observing');
					var userId = state.currentUserId;
					var driverUserId = state.publisherId;
					var tripType = Date.fromTimestamp(stream.getAttribute('type'));
					var startTime = Date.fromTimestamp(stream.getAttribute('startTime'));
					var endTime = Date.fromTimestamp(stream.getAttribute('endTime'));
					state.tripState = stream.getAttribute('state') || "new";
					var mapType = (state.useNavigation && state.isDriver && state.tripState == "started") ? "Travel/navigation" : "Travel/map"
					var sf = stream.fields;
					var fields = Q.extend({
						startTime: startTime,
						endTime: endTime,
						mapType: mapType,
						'id:Q_timestamp-departs': {
							time: startTime,
							capitalized: true
						},
						'id:Q_timestamp-arrives': {
							time: endTime,
							capitalized: true
						},
						'Travel/participants': {
							publisherId: state.publisherId,
							streamName: state.streamName,
							tripType: tripType
						},
						driver: state.currentUserId === driverUserId, // say template that current user is driver
						passenger: state.currentUserId !== driverUserId // say template that current user is passenger
					}, state);

					fields[mapType] = {
						directions: sf.directions && JSON.parse(sf.directions),
						from: stream.getAttribute('from'),
						to: stream.getAttribute('to'),
						center: function () {
							var coords = [
								stream.getCoordinates(userId),
								stream.getCoordinates(driverUserId),
								stream.getAttribute('from')];

							for (var i in coords) {
								if (coords[i] && coords[i].latitude && coords[i].longitude) {
									return coords[i];
								}
							}
						}()
					}

					if (mapType == 'Travel/navigation'){
						fields[mapType].compass = true;
						fields[mapType].reCenter = true;
						fields[mapType].fullScreen = true;
						fields[mapType].bottomMenu = true;
						fields[mapType].tilt = 45;
					}

					$te.attr({
						// set trip state to tool element
						"data-tripState": state.tripState,
						// set participant state to tool element
						"data-participantState": state.participantState,
						// set participant state to tool element
						"data-trackPassengers": state.trackPassengers ? "true" : "false"
					});

					// set up avatars
					var allCoordinates = stream.getAllCoordinates();
					var route = stream.getRoute(0);

					var avatars = {};
					var participants = extra && extra.participants;
					Q.each(participants, function () {
						var participantState = this.getExtra('state');
						var userId = this.userId;
						var coordinates = allCoordinates[userId];

						// if coordinates doesn't set - skip this user to avoid errors on map tool
						if (!coordinates || !coordinates.latitude || !coordinates.longitude){
							return;
						}

						// don't add on map riding passengers if showWhenRiding
						if(!state.showWhenRiding && participantState === "riding"){
							return;
						}

						// don't add driver avatar for navigation
						if(state.useNavigation && state.isDriver && state.tripState == "started" && userId == driverUserId){
							return;
						}

						// passengers
						avatars[userId] = tool.prepareUser(userId, coordinates);
					});

					// add avatars to Travel/map  tool
					fields[mapType].avatars = avatars;

					_proceed();

					// render Travel/trip template
					function _proceed() {
						Q.Template.render('Travel/trip', fields, function (err, html) {
							if (err) return;
							$(tool.element).html(html).activate(function () {
								if(fields.mapType == "Travel/navigation"){
									navigation = state.navigation = tool.child('Travel_navigation', 'Travel/navigation');
									navigation.state.onRefresh.add(function () {
										map = tool.map = this.state.mapTool;
										tool.fullScreenMode();
									});
								} else {
									map = tool.map = tool.child('Travel_map', 'Travel/map');
									var onMapEvent = function () {
										state.mapCustomized = true;

										// create "center" map
										if (!$("button[name=zoomCenter]", map.element).length) {
											var $button = $("<button name='zoomCenter'>" + state.text.trip.center + "</button>").on('click', function () {
												state.mapCustomized = false;
												Q.handle(tool[state.zoomMethod], tool);
												$(this).remove();
											}).appendTo(map.element);

											var flashCounter = 0;
											state.intervalIds['textBlinkTimerId'] = setInterval(function () {
												$button.toggleClass('flashText');

												if (flashCounter++ >= 6) {
													$button.removeClass("flashText");
													clearInterval(Q.getObject("intervalIds.textBlinkTimerId", state));
												}
											}, 300);
										}
									};

									// stop map rezooming if user made some custom actions with map
									map.state.onMapEvent('drag').set(onMapEvent);
									// this control zooming. Need button click event because when map loaded it change zoom
									$(map.element).on(Q.Pointer.fastclick, "button.gm-control-active", onMapEvent);

									// map native resize event
									map.state.onMapEvent('resize').set(function () {
										// call rezoom method if exist
										Q.handle(tool[state.zoomMethod], tool);
									});
								}

								// periodically check and fix height of tool and map tool
								state.intervalIds['recalculateHeight'] = setInterval(function () {
									// navigation activated
									if(navigation){
										// do not fix height when full screen is toggled
										if(navigation.state.fullScreen.toggled){
											return;
										}
										// set valid height for navigation
										tool.recalculateHeight(navigation.element)
									} else {
										// set valid height for map tool
										tool.recalculateHeight(map.element);
									}

									// correct tool height
									tool.recalculateHeight(tool.element);
								}, 1000);

								// decide whether need to start or stop watch user location
								tool.setWatchLocation();

								// on route changed event
								Travel.Trip.onRoute.set(function (fields) {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									state.tripStream = this;
									if(map){
										map.state.directions = fields.directions && JSON.parse(fields.directions);
										map.renderRoute(function () {
											// actions for navigation at new route
											if(navigation){
												var loadingSeconds = 0;
												state.intervalIds['loading'] = setInterval(function() {
													if (map.state.directionsRenderer) {
														clearInterval(state.intervalIds['loading']);
														if(navigation.state.compassFollow){
															// fix the markers rotation
															var $waypointMarkers = $('div[data-info=markers]', map.element).find('img').not('[src="' + navigation.state.driver.icon.url + '"], [src*="dd-via.png"]');
															$waypointMarkers.css({
																'transform-origin': '50% 100%',
																'transition': 'none',
																'transform': 'rotate(' + navigation.state.heading + 'deg)'
															}).parent().css({
																'overflow': 'visible'
															});
															navigation.recenterMap(true);
														}
														// Add intersections to state.steps
														navigation.setIntersections(map.state.directions.routes[0].legs);
														map.state.directionsRenderer.setPanel(navigation.$('.Travel_navigation_menu_path')[0]);
														navigation.$('.Travel_navigation_menu_open').show();
														if (state.userPickedUp) {
															Q.Audio.speak(state.text.navigation.nextRoute);
															state.userPickedUp = false;
														} else {
															Q.Audio.speak(state.text.navigation.routeRecalculate);
														}
													} else if (loadingSeconds == 10){
														clearInterval(Q.getObject("intervalIds.loading", state));
														console.warn(state.text.navigation.routePanelError);
													}
													loadingSeconds++;
												}, 500)
											} else {
												state.mapCustomized = false;
											}

											// call rezoom method if exist
											Q.handle(tool[state.zoomMethod], tool);

											//----- <test code> --------------
											// set driver to start point when reroute
											//state.test.currentIndex = 0;
											//----- </test code> --------------
										});
									}
								}, tool);

								// on start time changed event
								Travel.Trip.onStartTime.set(function (fields) {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									var departsTimeTool = tool.child('Q_timestamp-departs');

									if (!departsTimeTool) {
										return;
									}

									departsTimeTool.state.time = fields.startTime;
									departsTimeTool.stateChanged('time');
								}, tool);

								// on end time changed event
								Travel.Trip.onEndTime.set(function (fields) {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									var arrivesTimeTool = tool.child('Q_timestamp-arrives');

									if (!arrivesTimeTool) {
										return;
									}

									arrivesTimeTool.state.time = fields.endTime;
									arrivesTimeTool.stateChanged('time');
								}, tool);

								// on coordinates changed event
								Travel.Trip.onCoordinates(
									state.publisherId, state.streamName
								).set(function (changed) {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									for (var userId in changed) {
										if (!changed.hasOwnProperty(userId)) {
											continue;
										}

										// current user avatar move immediately
										// when new coordinates fetch
										if (userId == state.currentUserId) {
											continue;
										}

										// speak for driver if in full-screen mode
										if (navigation && navigation.state.fullScreen && navigation.state.fullScreen.toggled) {
											Streams.Avatar.get(userId, function (err, avatar) {
												if (err) return;
												Q.Audio.speak(state.text.navigation.messages.pickuplocationChange.interpolate({userName: avatar.displayName()}));
											});
										}

										tool.moveAvatar(userId, changed[userId]);
									}
								}, tool);

								// on user received a message
								Travel.Trip.onChatMessage.set(function (message) {
									// navigation not activated
									if(!navigation) return;
									// full-screen option is missing
									if(!navigation.state.fullScreen) return;

									if(navigation.state.fullScreen.toggled) {
										Streams.Avatar.get(message.byUserId, function (err, avatar) {
											if (err) return;
											Q.Audio.speak(avatar.displayName() + state.text.navigation.messages.said + message.content, {gender: avatar.gender});
										});
									}
								}, tool);

								// on user leave trip event
								Travel.Trip.onUserLeave.set(function(message){
									// if message for other stream - exit
									if (state.streamName !== message.name || state.publisherId !== message.publisherId) {
										return;
									}
									// speak for driver if in full-screen mode
									if (navigation && navigation.state.fullScreen && navigation.state.fullScreen.toggled) {
										Streams.Avatar.get(message.byUserId, function (err, avatar) {
											if (err) return;
											Q.Audio.speak(state.text.navigation.messages.canceledTrip.interpolate({userName: avatar.displayName()}));
										});
									}

									map.removeAvatar(message.byUserId);
								}, tool);

								// on trip state changed event
								Travel.Trip.onTripState.set(function (newState) {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									state.tripState = newState;

									// set tool element attribute to reflect display
									$te.attr("data-tripState", newState);

									// decide whether need to start or stop watch user location
									tool.setWatchLocation();
								}, tool);

								// on user state changed event
								Travel.Trip.onUserState.set(function (message) {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									var instructions = JSON.parse(message.instructions);
									var newState = instructions.state;
									var byUserId = message.byUserId;

									// only for current user actions
									if(byUserId === state.currentUserId){
										state.participantState = newState;

										// set tool element attribute to reflect display
										$te.attr("data-participantState", newState);

										// decide whether need to start or stop watch user location
										tool.setWatchLocation();
									}

									// if passenger picked up - hide button pickedUp
									if(newState === "riding"){
										// hide appropriate pickedup button
										$("button[name=pickedUp][data-userId=" + byUserId + "]", tool.element).hide();

										// hide passenger avatar
										if(!state.showWhenRiding){
											// remove avatar from map
											tool.map.removeAvatar(byUserId);
											if(state.navigation){
												// store variable to speech right text
												state.userPickedUp = true;
												// set bottom menu avatar status
												var $bm = $("div[name=bottomMenu]", state.navigation.element);
												var bottomMenuAvatar = Q.Tool.byId('bottom_menu_avatar_' + byUserId).element;
												$(bottomMenuAvatar).attr('data-state', 'riding');
												$(bottomMenuAvatar).closest('tr').fadeTo(1000, 0.5);
												if($bm.attr("data-state") == "closed"){
													$(bottomMenuAvatar).closest("tr").hide();
												}
											}
										}
									}
								}, tool);

								// on trip cancelled event
								Travel.Trip.onCancel.set(function () {
									// if message for other stream - exit
									if (state.streamName !== this.fields.name || state.publisherId !== this.fields.publisherId) {
										return;
									}

									// if current stream closed - fire onFinish event
									if(state.streamName === this.fields.name){
										Q.handle(state.onFinish, tool);
									}
								}, tool);

								// on passenger arriving event
								Travel.Trip.onPassengerArriving.set(function (message) {
									// if message for other stream - exit
									if (state.streamName !== message.name || state.publisherId !== message.publisherId) {
										return;
									}

									var stream = this;

									var instructions = JSON.parse(message.instructions);

									// show only if driver or message by current user
									if (!state.isDriver && instructions.passengerId !== state.currentUserId) {
										return;
									}

									if(state.navigation && state.navigation.state.fullScreen.toggled){
										if(!$("button[name=pickedUp]", navigation.element).length){
											var flashCounter = 0;
											$("button[name=pickedUp]", tool.element).clone().appendTo(navigation.element);
											var $puNav = $("button[name=pickedUp]", navigation.element);
											state.intervalIds['flashText'] = setInterval(function () {
												$puNav.toggleClass('flashText');
												if (flashCounter++ >= 5) {
													clearInterval(Q.getObject("intervalIds.flashText", state));
												}
											}, 500);
										}
									}

									var text = state.isDriver ?
										state.text.trip.pickUpName.interpolate({name: instructions.passengerName}) :
										state.text.trip.pickedUp;

									$("button[name=pickedUp]", tool.element)
										.html(text)
										.attr("data-userId", instructions.passengerId)
										.show()
										.off(Q.Pointer.fastclick)
										.on(Q.Pointer.fastclick, function(){
											var $this = $(this);

											stream.state(instructions.passengerId, "riding");

											$this.hide();
										});
								}, tool);

								// on driver arriving event
								Travel.Trip.onFinishArriving.set(function (message) {
									// if message for other stream - exit
									if (state.streamName !== message.name || state.publisherId !== message.publisherId) {
										return;
									}

									$("button[name=tripComplete]", tool.element).show();
								}, tool);

								// check from relatedFromTotals if trip recurring
								if (parseInt(Q.getObject(["relatedFromTotals", 'Calendars/recurring', 'Calendars/recurring'], stream)) > 0) {
									// create recurring tool
									$(".Calendars_recurring_setting", tool.element).tool("Calendars/recurring", {
										publisherId: state.publisherId,
										streamName: state.streamName,
										action: "settings",
										onBeforeDialog: function(callback){
											var recurringToolState = this.state;

											Calendars.Recurring.getRecurringCategory(stream, function(){
												var recurringStream = this;
												var tripRecurring = recurringStream.getAllAttributes();

												if (state.isDriver && tripRecurring.parentRecurring) {
													recurringToolState.possibleDays = Q.getObject(["parentRecurring", "days"], tripRecurring) || [];
												} else {
													recurringToolState.possibleDays = tripRecurring.days || [];
												}

												recurringToolState.period = tripRecurring.period;

												// Set first to all recurring days. If user have participant - days will updated.
												recurringToolState.days = tripRecurring.days || [];

												// check if user participated recurring category
												Streams.Participant.get.force(
													recurringStream.fields.publisherId,
													recurringStream.fields.name,
													Users.loggedInUser.id,
													function (err, participant) {
														var msg = Q.firstErrorMessage(err);
														if (msg) {
															console.warn("Calendars.getRecurringData: " + msg);
															return;
														}

														var userRecurring = participant && participant.getAllExtras() || {};

														// if user participant exist - set days from it extra
														recurringToolState.days = userRecurring.days || [];

														Q.handle(callback);
													}
												);

											});
										}
									}).activate();
								}
							});
						}, {
							tool: tool
						});
					}
				}, {
					participants: 100,
					withRelatedFromTotals: ['Calendars/recurring']
				});
			},
			/**
			 * Center map to current user position.
			 * @method zoomToCenter
			 * @param {object} coords Coordinates need to center map. If ommited, current user coordinates use.
			 */
			zoomToCenter: function (coords) {
				var tool = this;
				var state = this.state;
				var map = this.map;

				// rezoom map only if map zoom not customised
				if (state.mapCustomized) {
					return;
				}

				// while trip not yet started, use zoomToDestination
				if (state.tripState !== "started") {
					return tool.zoomToDestination();
				}

				var currentUserCoords = coords || Q.getObject(["map", "state", "avatars", state.currentUserId], tool);
				var lat = Q.getObject("latitude", currentUserCoords);
				var lng = Q.getObject("longitude", currentUserCoords);
				if (lat && lng) {
					map.state.googleMap.panTo(new google.maps.LatLng(lat, lng));
					map.state.googleMap.setZoom(16);
				}
			},
			/**
			 * Center map so that visible driver position and next point.
			 * @method zoomToDestination
			 */
			zoomToDestination: function () {
				var tool = this;
				var state = this.state;
				var map = this.map;

				// rezoom map only if map zoom not customised
				if (state.mapCustomized) {
					return;
				}

				// refresh trip stream with participants
				Streams.get(state.publisherId, state.streamName, function (err, tripStream, extra) {
					var fem = Q.firstErrorMessage(err);
					if (fem) {
						return console.warn("Travel.Trip.getUserState: " + fem);
					}

					var startPoint = tripStream.getAttribute("from");
					var endPoint = tripStream.getAttribute("to");
					var allCoordinates = tripStream.getAllCoordinates();

					// default rezooming when tool just loaded or when
					// resize or when reroute always happen
					// by default collected trip start/end points and all passengers
					if (state.tripState !== "started" || !state.isDriver) {
						var bounds = [startPoint, endPoint];

						Q.each(allCoordinates, function(userId, coords){
							bounds.push(coords);
						});

						return map.resumeZoomToDestination(bounds);
					}

					// empty points because we will have new from driver and closest passenger
					startPoint = endPoint = null;

					var polyline = Places.polyline(tripStream.getRoute());
					if(!polyline){
						throw new Exception("Travel/trip tool: route absent");
					}

					// closest passenger index
					var closestIndex = 0;

					// create points array with indexes as polyline index
					Q.each(allCoordinates, function(userId, coords){
						var closest = Places.closest({
							x: coords.latitude,
							y: coords.longitude
						}, polyline);

						// user doesn't found on polyline
						if(Q.isEmpty(closest)){
							return;
						}

						// set startPoint to driver position and skip
						if (userId === state.publisherId) {
							startPoint = coords;
							return;
						}

						// get passenger status
						extra.participants = extra.participants || [];
						var userState = null;
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
						});

						// set endPoint to point with lowest index in polyline
						if (userState === "waiting" && !closestIndex || closestIndex >= closest.index) {
							closestIndex = closest.index;
							endPoint = coords;
						}
					});

					// if endPoint empty - means driver collected all passengers
					// in this case endPoint = trip finish
					endPoint = endPoint || tripStream.getAttribute("to");

					// rezoom map with points calculated
					map.resumeZoomToDestination([startPoint, endPoint]);
				}, {participants: 100});
			},
			/**
		 	 * Center map so that visible driver position and current passenger position.
		 	 * @method zoomToDriver
		 	 */
			zoomToDriver: function (coords) {
				var tool = this;
				var state = tool.state;

				// rezoom map only if map zoom not customised
				if (state.mapCustomized) {
					return;
				}

				// while trip not yet started, use zoomToDestination
				if (state.tripState !== "started") {
					return tool.zoomToDestination();
				}

				var startPoint = coords || Q.getObject(["map", "state", "avatars", state.publisherId], tool);
				var endPoint = (state.participantState !== "waiting")? state.tripStream.getAttribute("to"): Q.getObject(["map", "state", "avatars", state.currentUserId], tool);

				tool.map.resumeZoomToDestination([startPoint, endPoint]);
			},
			/**
			 * Decide whether need to startWatchLocation or stopWatchLocation for current user.
			 * @method setWatchLocation
			 */
			setWatchLocation: function(){
				var tool = this;
				var state = this.state;

				// for driver
				if (state.isDriver) {
					if (!state.useNavigation && state.tripState === "started") {
						// for driver - always track location if trip started
						tool.startWatchLocation();
					} else if (state.tripState === "started" && state.navigation) {
						// wait coordinates from navigation
						state.navigation.state.onNewCoordinates.add(function (coords, heading) {
							if(!coords) return;
							var newCoords = {};
							newCoords.latitude = coords.latitude || coords.lat();
							newCoords.longitude = coords.longitude || coords.lng();
							newCoords.heading = heading;
							Travel.Trip.coordinates(state.publisherId, state.streamName, state.currentUserId, newCoords);
						})
					} else {
						tool.stopWatchLocation();
					}
					return;
				}

				// for passengers
				if(
					state.trackPassengers
					// don't track passengers location if passenger disappear from map when riding
					&& !(!state.showWhenRiding && state.participantState === "riding")
					// if all other conditions satisfy - track passenger location if he waiting or riding
					&& ["waiting", "riding"].indexOf(state.participantState) >= 0
				) {
					tool.startWatchLocation();
				} else {
					tool.stopWatchLocation();
				}
			},
			/**
			 * Get current geolocation
			 * @method getCurrentPosition
			 * @param {function} success Success callback
			 * @param {function} fail Fail callback
			 */
			getCurrentPosition: function (success, fail) {
				var tool = this;

				//----- <test code> --------------
				// when trip just started - set driver start position to trip start point
				/*var state = this.state;
				if(state.isDriver && !Q.getObject("map.state.avatars." + state.currentUserId, tool)){
					var from = state.tripStream.getAttribute("from");
					Q.handle(success, tool, [{coords: {latitude: from.latitude, longitude: from.longitude}}]);
					return;
				}*/
				//----- </test code> -------------

				navigator.geolocation.getCurrentPosition(function (pos) {
					Q.handle(success, tool, [pos]);
				}, function (err) {
					Q.handle(fail, tool, [err]);
					console.warn("Travel.trip.getCurrentPosition: ERROR(" + err.code + "): " + err.message);

					return false;
				}, {
					enableHighAccuracy: true, // need to set true to make it work consistently, it doesn't seem to make it any more accurate
					timeout: 5000,
					maximumAge: 0
				});
			},
			/**
			 * Get current geolocation and move avatar on map. Also send coordinates to server.
			 * @method updateLocation
			 * @param {object} pos Object with coordinates param
			 */
			updateLocation: function (pos) {
				var tool = this;
				var state = this.state;
				var callback = function (pos) {
					var crd = pos.coords;
					var currentUserId = state.currentUserId;

					// return if no coords
					if (!crd || !crd.latitude || !crd.longitude){
						return;
					}

					// get current coordinates from Travel/map tool
					var oldCoords = tool.map.state.avatars[currentUserId];

					//------ <test code> -----
					// Set user position to some random location
					/*var locations = [
					 {latitude: 54.223383, longitude: 45.212002},
					 //{latitude: 54.1891495, longitude: 45.1831073},
					 {latitude: 54.1975741, longitude: 45.2246432},
					 {latitude: 54.146609, longitude: 45.148471}
					 //{latitude: 54.18622, longitude: 45.18184} // BigPig
					 ];
					 crd = locations[Math.floor(Math.random() * 3)];*/
					 //crd = {latitude: 54.1975741, longitude: 45.2246432};
					//------ </test code> -------

					//------ <test code> ------
					// Set user position randomly moved related past location
					/*var plusminus = Math.floor(Math.random() * 2);
					if(plusminus > 0){
						crd = {
							latitude: parseFloat(oldCoords.latitude) + 0.001,
							longitude: parseFloat(oldCoords.longitude) - 0.001
						}
					}else{
						crd = {
							latitude: parseFloat(oldCoords.latitude) - 0.001,
							longitude: parseFloat(oldCoords.longitude) + 0.001
						}
					}*/
					//------- </test code> ------

					//------ <test code> ------
					// Set driver location move along with toute leg by leg
					// if last point of trip reached - don't change position
					/*if(state.isDriver && oldCoords){
						var polyline = Places.polyline(state.tripStream.getRoute());
						var testCurrentIndex = state.test.currentIndex || 0;
						var testCurrentPoint = polyline[testCurrentIndex] || polyline[0]; // if index wrong - start from 0
						var testDistance = Places.distance(testCurrentPoint.x, testCurrentPoint.y, oldCoords.latitude, oldCoords.longitude);
						var testClosest = {};
						testClosest.index = testCurrentIndex;
						var testLastIndex = polyline.length - 1;

						// step between locations
						// it's very slow if process each location in a polyline
						var testNextIndex = testClosest.index;
						testDistance = 0;

						// calculate testNextIndex to point not closer than 100 meters to current point
						while(testDistance < 100){
							testNextIndex++;
							if(testNextIndex >= testLastIndex){
								testNextIndex = testLastIndex;
								break;
							}
							testDistance = Places.distance(testCurrentPoint.x, testCurrentPoint.y, polyline[testNextIndex].x, polyline[testNextIndex].y);
						}

						// else move to next point
						//if(Q.isEmpty(state.test.routeCustomised) && testNextIndex >= 49){ // custom location for 49 index
						//	state.test.routeCustomised = true; // customise route only once
						//	state.test.currentIndex = 0;
						//	crd = {latitude: 54.184322, longitude: 45.205904};
						//}else{
							crd = {latitude: polyline[testNextIndex].x, longitude: polyline[testNextIndex].y};
						//}

						// save polyline index to state to use it later
						state.test.currentIndex = testNextIndex;
					} else if (!state.isDriver) { // passenger always stay, if picked up - disappeared from map
						return;
					}*/
					//------- </test code> ------

					var calculatedHeading = 0;
					var newCoords = {
						latitude: parseFloat(crd.latitude),
						longitude: parseFloat(crd.longitude)
					};

					var distanceMoved;
					if (oldCoords && oldCoords.latitude && oldCoords.longitude) {
						distanceMoved = Places.distance(newCoords.latitude, newCoords.longitude, oldCoords.latitude, oldCoords.longitude);
						calculatedHeading = Places.heading(oldCoords.latitude, oldCoords.longitude, crd.latitude, crd.longitude);
					} else {
						distanceMoved = Math.max(state.distances.mapZoom, state.distances.precision) + 1;
					}

					// change heading only for driver
					if(state.isDriver){
						newCoords.heading = crd.heading || calculatedHeading;
					}

					// move current user avatar on map
					tool.moveAvatar(currentUserId, newCoords);

					// send new ccordinates to server, so other users can get new coordinates
					Travel.Trip.coordinates(state.publisherId, state.streamName, currentUserId, newCoords);
				};

				// coords already set in arguments - just call callback
				if (pos) {
					Q.handle(callback, tool, [pos]);
					return;
				}

				// if coords absent - get them and call callback
				tool.getCurrentPosition(callback);
			},
			/**
			 * prepare user avatar object for Travel/map tool
			 * the main issue here - is that driver have special car icon
			 * @method prepareUser
			 * @param {string} userId
			 * @param {object} coordinates
			 */
			prepareUser: function (userId, coordinates) {
				var state = this.state;

				if (userId === state.publisherId) {
					// set special icon for driver
					return Q.extend(coordinates, {
						avatar: {
							icon: Q.url('{{Travel}}/img/icon_car.png'),
							reflectIconChanges: false,
							className: 'Travel_map_car'
						}
					});
				}

				return coordinates;
			},
			/**
			 * Move avatar on map
			 * @method moveAvatar
			 * @param {string} userId
			 * @param {object} coordinates
			*/
			moveAvatar: function (userId, coordinates) {
				var tool = this;
				var state = this.state;
				var navigation = state.navigation || false;
				var map = (navigation)? navigation.child('Travel_map', 'Travel/map'): tool.child('Travel_map', 'Travel/map');
				if (Q.typeOf(map) !== 'Q.Tool') {
					return console.warn("Travel/trip/moveAvatar: map is not a tool");
				}
				var driverUserId = state.publisherId;
				
				var avatar = Q.getObject(["state", "avatars", userId], map);

				// if new user - add it on map
				if (!avatar) {
					if (navigation) {
						// if navigation activated don't add drivers avatar
						if (userId != driverUserId) {
							map.addAvatar(userId, tool.prepareUser(userId, coordinates));
						}
					} else {
						map.addAvatar(userId, tool.prepareUser(userId, coordinates));
					}
					return;
				}
				
				// if user just added - just place it on map
				if (!avatar.latitude || !avatar.longitude) {
					map.moveAvatar(userId, tool.prepareUser(userId, coordinates));
					return;
				}
		
				// if user already on map - animate moving
				avatar.heading = avatar.heading || 0;
				coordinates.heading = coordinates.heading || avatar.heading;
		
				avatar.heading = function(a, c){
					var r, r1, r2;
					if(a > c){
						r1 = a - c;
						r2 = c - a + 360;
		
						if (r1 > r2) {
							if(a > 0){
								return a - 360;
							}else{
								return a;
							}
						}else{
							return a;
						}
					}else{
						return a;
					}
		
				}(avatar.heading, coordinates.heading);
				coordinates.heading = function(a, c){
					var r, r1, r2;
					if(a < c){
						r1 = c - a;
						r2 = a - c + 360;
		
						if(r1 > r2){
							if(a > 0){
								return -1*r2;
							}else{
								return a - r2;
							}
						}else{
							return c;
						}
					}else{
						return c;
					}
				}(avatar.heading, coordinates.heading);
		
				if (navigation) {
					// navigation moves marker of the driver
					if (userId != driverUserId) {
						_animateMove();
					}
				} else {
					_animateMove();
				}

				// call rezoom method if exist
				Q.handle(tool[state.zoomMethod], tool, [coordinates]);

				function _animateMove() {
					Q.Animation.play(function (x, y) {
						map.moveAvatar(userId, {
							latitude: avatar.latitude + (coordinates.latitude - avatar.latitude) * y,
							longitude: avatar.longitude + (coordinates.longitude - avatar.longitude) * y,
							heading: avatar.heading + (coordinates.heading - avatar.heading) * y
						});
					}, state.animation.duration, state.animation.ease);
				}
			},
			/**
			 * Start watch for user current location
			 * @method startWatchLocation
			 */
			startWatchLocation: function () {
				var tool = this;
				var state = tool.state;

				// if timer already exists - return
				if (!Q.isEmpty(Q.getObject("intervalIds.geoLocationUpdateTimerId", state))){
					return;
				}

				/*if (!Q.isEmpty(state.backgroundGeolocation)) { // cordova-background-geolocation exist
					state.backgroundGeolocation.start();
					state.intervalIds['geoLocationUpdateTimerId'] = true;
					return;
				}*/

				//------ <test code> ------
				// change driver position according to array of coordinates
				/*var coords = [
					[54.199946, 45.225621],
					[54.199718, 45.225489],
					[54.199519, 45.225364],
					[54.199377, 45.225642],
					[54.199328, 45.226164],
					[54.199214, 45.226463],
					[54.199470, 45.226971],
					[54.200311, 45.228441],
					[54.201246, 45.226263]
				];
				var i = 0;
				state.intervalIds['geoLocationUpdateTimerId'] = setInterval(function () {
					tool.updateLocation({'coords': {
						latitude: coords[i][0],
						longitude: coords[i][1]
					}});

					if (i < coords.length-1) {
						i++;
					} else {
						i = 0;
					}
				}, 3000);
				return;*/
				//------ </test code> ------

				// set watch location
				state.intervalIds['geoLocationUpdateTimerId'] = navigator.geolocation.watchPosition(function (pos) {
					tool.updateLocation(pos);
				}, function (err) {
					console.warn("navigator.geolocation.watchPosition: ERROR(" + err.code + "): " + err.message);
					return false;
				}, {
					enableHighAccuracy: true, // need to set true to make it work consistently, it doesn't seem to make it any more accurate
					timeout: 5000,
					maximumAge: 0
				});
			},
			/**
			 * Stop watch for current user location
			 * @method stopWatchLocation
			 */
			stopWatchLocation: function () {
				var tool = this;
				var state = tool.state;
				var geoLocationUpdateTimerId = Q.getObject("intervalIds.geoLocationUpdateTimerId", state);

				// if timer already exists - return
				if (Q.isEmpty(geoLocationUpdateTimerId)){
					return;
				}

				if (!Q.isEmpty(state.backgroundGeolocation)) { // cordova-background-geolocation exist
					state.backgroundGeolocation.stop();
				}

				navigator.geolocation.clearWatch(geoLocationUpdateTimerId);

				state.intervalIds['geoLocationUpdateTimerId'] = null;
			},
			/**
			 * Calculate valid tool height.
			 * Get parent inner height and deduct outer height of all siblings inside parent.
			 * @method recalculateHeight
			 * @param element Element need to fix height (instance of DOM or jquery object)
			 */
			recalculateHeight: function (element) {
				var $element = $(element);
				// 0.5 weight coefficient need because jquery round height, and this happen to appear scrollbar
				var resHeight = $element.parent().innerHeight() - 0.5;
				Q.each($element.siblings(), function(){
					resHeight -= $(this).outerHeight(true) + 0.5;
				});

				// round to higher value
				resHeight = Math.ceil(resHeight);

				if ($element[0].getBoundingClientRect().height === resHeight) {
					return;
				}

				$element.outerHeight(resHeight);

				Q.layout(element);
			},
			/**
			 * Fix the window for Travel/trip tool during full-screen toggle
			 * @method fullScreenMode
			 */
			fullScreenMode: function(){
				var tool = this;
				var state = tool.state;
				var navigation = state.navigation;

				if(Q.typeOf(navigation) !== "Q.Tool"){
					throw new Q.Error("Travel/trip tool: Navigation not a tool");
				}

				navigation.toggleFullScreen();

				// define fullscreen handle event from navigation
				navigation.state.onFullScreen.add(function (toggled) {
					// elements to hide in full-screen mode
					var columns = tool.element.closest('.Q_columns_tool');
					var columnsOverflow = tool.element.closest('.Q_overflow');
					var columnsColumn = tool.element.closest('.Q_columns_column');
					var columnsTitle = $(columns).find('.Q_columns_title');
					var bottomMenu = $(tool.element).find('.Travel_navigation_bottom_menu');

					// full screen mode is on
					if(!toggled){
						// hide bottom menu
						$(bottomMenu).removeAttr('data-fullScreen');
						// return the saved style to tool
						$(columns).css({
							width: state.fullScreen.columnsWidth,
							height: state.fullScreen.columnsHeight
						});
						if(columnsOverflow){
							$(columnsOverflow).css({
								width: state.fullScreen.columnsOverflowWidth,
								height: state.fullScreen.columnsOverflowHeight
							});
						}
						// do not show title if the column is only one
						if(!Number($(columnsColumn).attr('data-index'))) return;
						$(columnsTitle).removeAttr('fullscreentoggled');
						return;
					}
					// backup the style of tool to rollback
					if(columnsOverflow && columns){
						state.fullScreen = {
							columnsWidth: columns.style.width,
							columnsHeight: columns.style.height,
							columnsOverflowWidth: columnsOverflow.style.width,
							columnsOverflowHeight: columnsOverflow.style.height
						}
					} else {
						 state.fullScreen = {
							columnsWidth: columns.style.width,
							columnsHeight: columns.style.height,
						}
					}
					$(columnsTitle).attr('fullscreentoggled', true);
					$(bottomMenu).attr('data-fullScreen', true);
					
					// make the tool filled in the window
					$(columns).css({
						width: window.innerWidth + 'px',
						height: window.innerHeight + 'px'
					});

					if(!columnsOverflow) return;
					// for device
					$(columnsOverflow).css({
						width: window.innerWidth + 'px',
						height: window.innerHeight + 'px'
					});
				});
			},
			Q: {
				beforeRemove: function () {
					var tool = this;
					var state = this.state;

					tool.stopWatchLocation();

					for (var intervalId in state.intervalIds) {
						// we can use any argument (null, undefined, ...)
						// in clearWatch and clearInterval
						navigator.geolocation.clearWatch(state.intervalIds[intervalId]);
						clearInterval(state.intervalIds[intervalId]);
					}

					// remove all child tools
					var children = tool.children('', 1);
					for (var id in children) {
						for (var n in children[id]) {
							if ($(tool.element).has(children[id][n].element).length === 0) {
								continue;
							}
							children[id][n].remove(false, true);
						}
					}
				}
			}
		});

	Q.Template.set('Travel/trip',
		'<div class="Travel_trip_actions">'
		+ '{{{tool "Travel/participants"}}}'
		+ '{{#if driver}}'
		+ '	<button class="Q_button" name="startDriving">{{trip.startDriving}}</button>'
		+ '	<button class="Q_button" name="pickedUp">{{trip.pickUpName}}</button>'
		+ '	<button class="Q_button" name="tripComplete">{{trip.tripComplete}}</button>'
		+ '	<button class="Q_button" name="tripCancel">{{trip.driverDiscontinue}}</button>'
		//+ '	<button class="Q_button" name="test" style="display: block">Test</button>'
		+ '{{/if}}'
		+ '{{#if passenger}}'
		+ '	<button class="Q_button" name="pickMeUp">{{trip.pickMeUp}}</button>'
		+ '	<button class="Q_button" name="pickedUp">{{trip.pickedUp}}</button>'
		+ '	<button class="Q_button" name="pickupLocation">{{trip.pickupLocation}}</button>'
		+ '	<button class="Q_button" name="tripRefuse">{{trip.passengerRefuse}}</button>'
		+ '{{/if}}'
		+ '<div class="Calendars_recurring_setting"></div>'
		+ '</div>'
		+ '<div class="Travel_trip_times">'
		+ '{{#if startTime}}'
		+ '	<div class="Travel_trip_time_start">'
		+ '  <span data-display="onNew">{{trip.departs}}:</span> '
		+ '  <span data-display="onStart">{{trip.departed}}:</span> '
		+ '  {{{tool "Q/timestamp" "departs"}}}'
		+ ' </div>'
		+ '{{/if}}'
		+ '{{#if endTime}}'
		+ '	<div class="Travel_trip_time_end">'
		+ '  <span data-display="onNew">{{trip.arrives}}:</span> '
		+ '  <span data-display="onStart">{{trip.arrives}}:</span> '
		+ '  <span data-display="onArrived">{{trip.arrived}}:</span> '
		+ '  {{{tool "Q/timestamp" "arrives" relative=false time=arrives}}}'
		+ ' </div>'
		+ '{{/if}}'
		+ '</div>'
		+ '{{{tool mapType}}}'
		, {text: "Travel/content"});
})(Q, Q.jQuery, window);