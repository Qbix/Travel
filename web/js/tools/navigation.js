(function (Q, $, window, undefined) {

	var Users = Q.Users;
	var Streams = Q.Streams;
	var Places = Q.Places;
	var Travel = Q.Travel;

	/**
	 * Travel/navigation tool.
	 */

	/**
	 * Renders the 3D imitated navigation, with a map and controls.
	 * @class Travel navigation
	 * @constructor
	 * @param {Object} [options]
	 *   @param {String} [options.mapTool] rendered Travel/map tamplate to appand instead of default Travel/map
	 *   @param {Array} [options.center] Required. Where to center the map
	 *   @param {Boolean} [options.search] If true - will enable the search button and inputBox
	 *   @param {Boolean} [options.compass] If true - will enable the compass button to follow the marker
	 *   @param {Array} [options.skipModes] The keys of those mods that do not need to create (fromCar, fromNorth, fullRoute)
	 *   @param {Boolean} [options.fullScreen] If true - will enable the fullscreen button
	 *   @param {Boolean} [options.reCenter] If true - will enable button which re centering the map
	 *   @param {Boolean} [options.centeredAvatars] If false - will create avatars in map with 3-dimensional effect
	 *   @param {Boolean} [options.draggable] if false - disables the draggable mod of the map
	 *   @param {Object} [options.distance] distance meters configuration
	 *   @param {Number} [options.distance.secondsToSpeech] The seconds before intersection to begin speech
	 *   @param {Number} [options.distance.afterTurn] The Fraction of intersection to update top menu information about next turn
	 *   @param {Integer} [options.zoom=18] Initial zoom level of the map
	 *   @param {Integer} [options.tilt=45] The tilt angle of the map
	 *   @param {Number} geoLocationUpdateInterval Seconds interval which user location will check
	 *   @param {Q.Event} [options.onRefresh] Event after navigation have been refreshed
	 *   @param {Q.Event} [options.onAvatarsAdded] Q.event execute when all avatar markers added on map
	 *   @param {Q.Event} [options.onRouteCreated] Q.event execute when route added on map
	 *   @param {Q.Event} [options.onFullScreen] Q.event execute when full-screen mod toggling,
	 *      arguments 0(full-screen off) and 1(full-screen on)
	 *   @param {Q.Event} [options.onNewCoordinates] Q.event execute when new coordinates received
	 */

	Q.Tool.define("Travel/navigation", function (options) {

			if (!options.center && !options.mapTool) {
				throw new Q.Error("Travel/navigation: please specify the center of the map");
			}

			if (!Users.loggedInUser) {
				throw new Q.Error("Travel/navigation: you need to be logged in to use navigation");
			}

			// proceed to construct the tool
			var tool = this;
			var state = tool.state;

			// set text
			Q.Text.get("Travel/content", function (err, result) {
				var msg = Q.firstErrorMessage(err);
				if (msg) {
					throw new Q.Error(msg);
				}
				state.text = result;
			});

			// adding default style CSS
			Q.addStylesheet('{{Travel}}/css/navigation.css', {slotName: 'Travel'});

			// support cordova-background-geolocation plugin
			Q.addEventListener(document, 'deviceready', function () {
				console.info("Device ready");

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
					console.log(location)
				}, function (err) {
					console.warn("backgroundGeolocation Error: Didnt get an update", err);
				});

				state.backgroundGeolocation = backgroundGeolocation;
			}, false);

			// the controller interface for the recognition service
			tool.recognition = ('webkitSpeechRecognition' in window) ? new webkitSpeechRecognition() : false

			// get language
			tool.language = (navigator.language == 'ru-RU') ? navigator.language : 'en-US'

			// loading throbber
			tool.preloader();

			// draw the tool, see method below
			tool.refresh();
		},

		{ // Default parameters
			mapTool: false,
			center: null,
			search: false,
			compass: false,
			skipModes: [],
			fullScreen: false,
			reCenter: false,
			bottomMenu: false,
			centeredAvatars: false,
			draggable: true,
			distance: {
				secondsToSpeech: 5,
				afterTurn: 0.3,
				farManeuver: 100
			},
			speech: {
				speechFarManeuver: true
			},
			tilt: 45,
			zoom: 18,
			geoLocationWatchId: null,
			geoLocationUpdateInterval: 3, // seconds
			intervalIds: {},
			driver: Q.url("{{Travel}}/img/icon_standard.png"),
			throbber: Q.url("{{Q}}/img/throbbers/bars.gif"),
			onRefresh: new Q.Event(),
			onAvatarAdded: new Q.Event(),
			onRouteCreated: new Q.Event(),
			onFullScreen: new Q.Event(),
			onNewCoordinates: new Q.Event()
		},

		{
			/**
			 * Refresh the display
			 * @method refresh
			 * @param {Function} callback
			 */
			refresh: function (callback) {
				var tool = this;
				var state = tool.state;
				var $te = $(tool.element);
				// if the Travel/map template already exists
				if (state.mapTool && !tool.child('Travel_map', 'Travel/map')) {
					$te.html(state.mapTool);
					Q.activate(tool.element, function () {
						$te.removeAttr('data-loading');
						_renderNavigation();
					});
				} else {
					if (state.center.latitude && state.center.longitude) {
						state.center = {
							lat: state.center.latitude,
							lng: state.center.longitude
						};
					}

					Q.Template.render(
						"Travel/navigation", {
							'Travel/map': {
								center: {
									latitude: state.center.lat,
									longitude: state.center.lng
								}
							},
							Travel: Q.url('{{Travel}}'),
							search: state.search,
							compass: state.compass,
							reCenter: state.reCenter,
							bottomMenu: state.bottomMenu,
							reCenterText: state.text.navigation.reCenter,
							fullScreen: state.fullScreen
						},
						function (err, html) {
							if (err) return;
							$te.html(html);
							Q.activate(tool.element, function () {
								$te.removeAttr('data-loading').attr("data-centeredAvatars", state.centeredAvatars);
								_renderNavigation();
							});
						}
					);
				}

				function _renderNavigation() {
					var Travel_navigation_map = tool.child('Travel_map', 'Travel/map');

					// Checking whether the Travel map is an tool
					if (!Travel_navigation_map || Q.typeOf(Travel_navigation_map) !== 'Q.Tool') {
						throw new Q.Error("Travel/navigation tool: Travel map not a tool");
					}

					Travel_navigation_map.state.onMap.add(function () {
						state.mapTool = this; // Navigation map tool
						state.map = this.state.googleMap; // Navigation google map

						// If there is a Travel/map template but no center
						if (!state.center && state.mapTool) {
							if (!state.mapTool.state.center.latitude || !state.mapTool.state.center.longitude) {
								throw new Q.Error("Travel/navigation: please specify the center of the map template");
							}
							state.center = {
								lat: state.mapTool.state.center.latitude,
								lng: state.mapTool.state.center.longitude
							};
						}

						// enable geocoder to get addresses by coordinates
						state.geocoder = new google.maps.Geocoder;

						// default options for Navigation map
						state.map.setOptions({
							styles: [{
								"elementType": "labels.icon",
								"stylers": [{"visibility": "off"}]
							}],
							draggable: state.draggable,
							zoom: state.zoom,
							fullscreenControl: false,
							streetViewControl: false,
							zoomControl: false
						});

						// prevent InfoWindow to appear
						google.maps.InfoWindow.prototype.open = function () {
							return;
						}

						var overlay = new google.maps.OverlayView();
						overlay.draw = function () {
							// give id to marker elements to rotate
							if (!$("div[data-info=markers]", tool.element).length) {
								$(this.getPanes().markerLayer).attr("data-info", "markers");
							}
							return
						}
						overlay.setMap(state.map);

						// any changes in "from" section of top menu will call textfill plugin
						$te.on("DOMSubtreeModified", "span[name=menuFrom]", function () {
							var $mf = $('div[name=menuFromDiv]', tool.element);
							if ($mf.text().trim().length) {
								$mf.plugin('Q/textfill');
							}
						});

						// Top menu start
						state.topMenu = {
							$from: $("span[name=menuFrom]", tool.element),
							$maneuver: $("div[name=maneuver]", tool.element),
							$distance: $("div[name=distance]", tool.element)
						}
						$te.on(Q.Pointer.fastclick, "div[name=menu]", function () {
							if ($te.attr('data-status') == 'topMenuOpened') {
								$te.attr({
									'data-status': 'topMenuClosed',
									'data-anim': 'topMenuClose'
								});
							} else {
								$te.attr('data-anim', 'topMenuOpen');
								setTimeout(function () {
									$te.attr('data-status', 'topMenuOpened');
								}, 500);
							}
						});
						// Top menu end

						// Search button start
						if (state.search) {
							// connect API SearchBox to search input of navigation

							$te.on(Q.Pointer.fastclick, "div[name=searchBut]", function () {
								$te.attr('data-anim', 'search');
								setTimeout(function () {
									$te.attr('data-status', 'searchOpened');
								}, 500);
							});

							$te.on(Q.Pointer.fastclick, "img[name=searchClose]", function () {
								$te.removeAttr('data-status data-anim');
							});

							$te.on(Q.Pointer.fastclick, "img[name=searchSpeech]", function () {
								tool.speechRecognition(this);
							});

							var searchBox = new google.maps.places.SearchBox($('div[name=searchInp] input', tool.element)[0]);
							searchBox.addListener('places_changed', function () {
								var places = searchBox.getPlaces();

								// searched place don't gave a result
								if (places.length == 0) return;

								Places.route.onError.add(function (directions, status) {
									// speech the error
									Q.Audio.speak(state.text.navigation.routeError[status]);
								});

								if (state.mapTool.state.directions) {
									// If exists another route, delete to create a new
									delete state.mapTool.state.directions;
									state.steps = [];
								}
								state.mapTool.state.from = state.center;
								state.mapTool.state.to = places[0].geometry.location;
								state.mapTool.renderRoute(function (callback) {
									// waiting for directionsRenderer
									state.intervalIds.searchRenderLoading = setInterval(function () {
										if (state.mapTool.state.directionsRenderer) {
											clearInterval(state.intervalIds.searchRenderLoading);
											state.mapTool.state.directionsRenderer.setPanel($("div[name=menuPath]", tool.element)[0]);
											state.map.setZoom(state.map.getZoom() - 2);
											// ren-ceter map by tilt
											var latLngByTilt = state.mapTool.state.directions.routes[0].overview_path[0];
											state.map.setCenter(latLngByTilt);
											$("div[name=menuOpen]", tool.element).show();
										}
									});

									Q.Audio.speak(state.text.navigation.routeRecalculate);
									Q.handle(state.onRouteCreated, tool);
								})

								$te.removeAttr('data-status data-anim');
								if (state.compass) {
									tool.disableCompass(true);
								}

							});
						}
						// Search button end

						// Compass button start
						if (state.compass) {
							state.compass = $("div[name=compass]", tool.element)[0];
							var compassModes = ["fromCar", "fromNorth", "fullRoute"];
							if (state.skipModes.includes("fromCar") &&
								state.skipModes.includes("fromNorth") &&
								state.skipModes.includes("fullRoute")) {
								throw new Q.Error("Travel/navigation: skipModes[] must leave at least 1 mode");
							}
							if (state.skipModes.length) {
								for (var i = 0; i < compassModes.length; i++) {
									if (state.skipModes.includes(compassModes[i])) {
										compassModes.splice(i, 1);
										i--;
									}
								}
							}
							$te.attr('data-action', compassModes[0]);

							$te.on(Q.Pointer.fastclick, "div[name=compass]", function () {
								var dataAction = $te.attr('data-action');
								var nextAction = (compassModes.indexOf(dataAction)) + 1;
								nextAction = compassModes[nextAction] || compassModes[0];
								tool.setMapMode(nextAction);
							});
							state.compassFollow = true;
						} else {
							state.compassFollow = false;
						}
						// Compass button end

						// Re-center button start
						if (state.reCenter) {
							state.reCenter = $("div[name=reCenter]", tool.element)[0];
							$te.on(Q.Pointer.fastclick, "div[name=reCenter]", function () {
								tool.setMapMode('fromCar');
							});
						}
						// Re-center button end

						// Full screen button
						if (state.fullScreen) {
							state.fullScreen = {
								toggled: false,
								UI: $("div[name=fullScreen]", tool.element)[0]
							};

							$te.on('click', "div[name=fullScreen]", function () {
								tool.toggleFullScreen();
							});
						}
						// Full screen button end

						// Bottom menu start
						if (state.bottomMenu) {
							$te.attr("data-bottomMenu", true);
							var $bm = $("div[name=bottomMenu]", tool.element);
							var $bd = $("div[name=backdrop]", tool.element);
							// toggler click
							$te.on(Q.Pointer.fastclick, "div[name=bottomMenu]", function () {
								var $this = $(this);
								if ($bm.attr("data-state") == "closed") {
									$bm.attr("data-state", "opened");
									$bd.fadeTo(500, 1);
									setTimeout(function () {
										$this.find("tr").show();
									}, 500);
								} else {
									setTimeout(function () {
										$this.find(".Users_avatar_tool[data-state=riding]").closest("tr").hide();
									}, 500);
									$bd.fadeOut(0);
									$bm.attr("data-state", "closed");
								}
							});
							// background click
							$te.on(Q.Pointer.fastclick, "div[name=backdrop]", function () {
								$bd.fadeOut(0);
								$bm.attr("data-state", "closed");
							});
						}
						// Bottom menu end

						// Drivers icon start
						if (state.driver) {
							// Default size for marker
							var scaledSize = 60;
							// Adding driver's marker to the map
							if (state.driver == 'car') {
								state.driver = Q.url("{{Travel}}/img/icon_car.png");
								scaledSize = 40;
							} else if (state.driver == 'standard') {
								state.driver = Q.url("{{Travel}}/img/icon_standard.png");
							}
							var driver = new google.maps.Marker({
								position: state.center,
								map: state.map,
								icon: {
									url: state.driver,
									anchor: new google.maps.Point(scaledSize / 2, scaledSize / 2),
									scaledSize: new google.maps.Size(scaledSize, scaledSize)
								}
							});
							// Adding driver's marker to the global markers variable
							state.driver = driver;
						}
						// Drivers icon end

						// If exists "from" and "to" options generate route
						if (state.from && state.to) {

							// If exists another route, delete to create a new
							if (state.mapTool.state.directions) {
								delete state.mapTool.state.directions;
								state.steps = [];
							}

							state.mapTool.state.from = state.from;
							state.mapTool.state.to = state.to;

							// If exists avatars in route, generate them by navigation
							if (state.avatars) {
								for (var avatar in state.avatars) {
									// Do not generate avatar for driver
									if (avatar != Users.loggedInUser.id) {
										if (state.avatars[avatar].latitude && state.avatars[avatar].longitude) {
											tool.addAvatar(avatar, state.avatars[avatar], true);
											state.mapTool.state.waypoints.push(state.avatars[avatar]);
										} else {
											tool.addAvatar(avatar, {
												latitude: state.avatars[avatar].position.lat(),
												longitude: state.avatars[avatar].position.lng()
											}, true);
											state.mapTool.state.waypoints.push(state.avatars[avatar].position);
										}
									}
								}
							}

							state.from = new google.maps.LatLng(state.from.latitude, state.from.longitude);
							state.to = new google.maps.LatLng(state.to.latitude, state.to.longitude);

							state.mapTool.renderRoute({preserveViewport: true}, function (callback) {
								// waiting for directionsRenderer
								state.intervalIds.renderRoute = setInterval(function () {
									if (state.mapTool.state.directionsRenderer) {
										clearInterval(state.intervalIds.renderRoute);
										state.mapTool.state.directionsRenderer.setPanel($("div[name=menuPath]", tool.element)[0]);
										$("div[name=menuOpen]", tool.element).show();
										tool.setIntersections(state.mapTool.state.directions.routes[0].legs);
										if (state.steps) {
											// Set the first intersection information to top menu
											var distanceValue = Q.getObject([0, "distanceValue"], state.steps);
											if (distanceValue) {
												if (distanceValue - (distanceValue % 100) < 1000 && distanceValue - (distanceValue % 100) > 0) {
													state.topMenu.$distance.html(distanceValue - (distanceValue % 100) + ' ' + state.text.navigation.meter);
												} else {
													var distanceText = Q.getObject([0, "distanceText"], state.steps);
													if (distanceText) {
														state.topMenu.$distance.html(distanceText);
													}
												}
											}
											var maneuver = Q.url("{{Travel}}/img/turns/straight.png");
											if (state.steps[1] && state.steps[1].maneuver && state.steps[1].maneuver != '') {
												maneuver = Q.url("{{Travel}}/img/turns/" + state.steps[1].maneuver + ".png");
											}
											state.topMenu.$maneuver.css({
												"background-image": "url(" + maneuver + ")"
											});
											if (state.steps[1] && state.steps[1].instructions && state.steps[1].instructions != '') {
												state.topMenu.$from.html(state.steps[1].instructions.match(/.+(<b>.+<\/b>)/)[1]);
											}
										}
										Q.handle(state.onRouteCreated, tool);
									}
								}, 500)

								Q.Audio.speak(state.text.navigation.routeRecalculate);
							});
						}

						// Events
						state.map.addListener('dragstart', function () {
							if (state.compass && state.compassFollow) {
								tool.disableCompass(true);
								$te.attr('data-action', 'fromNorth');
							}
						});

						state.map.addListener('dragend', function () {
							if (state.reCenter && $(state.reCenter).is(':hidden')) {
								$(state.reCenter).show();
							}
						});

						state.map.addListener('zoom_changed', function () {
							if (state.reCenter && $(state.reCenter).is(':hidden')) {
								$(state.reCenter).show();
							}
							clearTimeout(state.intervalIds.zoomTimeout)
							state.onZoom = true;
							state.intervalIds.zoomTimeout = setTimeout(function () {
								state.onZoom = false;
							}, 3000)
						});

						// Generated results of steps to next position
						var deltaLat, deltaLng;
						// Steps of generated position of waypoint
						state.steps = [];
						// Intersection parameters
						state.intersection = {
							goingToIntersection: false,
							arrivedToIntersection: false,
							lastIntersection: false
						};

						// Make driver's marker move smoother
						function _transition(coords) {
							i = 0;
							var closest = Places.closest({
								x: coords.latitude,
								y: coords.longitude
							}, state.steps);
							if (!closest) {
								return false;
							}
							deltaLat = (closest.x - state.center.lat) / 100;
							deltaLng = (closest.y - state.center.lng) / 100;
							tool.rotate(closest.x, closest.y);
							_moveMarker();
							// Update bottom panel
							tool.updatePassengerList();
						};

						// Smoothly moves the marker to the received position
						function _moveMarker() {
							state.center.lat += deltaLat;
							state.center.lng += deltaLng;
							if (state.compassFollow) tool.recenterMap(true);
							if (state.driver) state.driver.setPosition(state.center);

							// searching for closest step
							if (state.steps.length) {
								var closest = Places.closest({
									x: state.center.lat,
									y: state.center.lng
								}, state.steps)

								if (closest) {
									// set the index for the actions for 1st point
									closest.index = (!closest.fraction && closest.index == 1) ? closest.index - 1 : closest.index;
									// distance between current location and closest step
									var distance = Places.distance(state.center.lat, state.center.lng, Q.getObject([closest.index, "x"], state.steps), Q.getObject([closest.index, "y"], state.steps));
									var speed = Q.getObject(["mps"], state.speed);

									// if the next maneuver is far - say the meters/kilometers to next turn
									if (distance > state.distance.farManeuver &&
										state.speech.speechFarManeuver &&
										!state.intersection.arrivedToIntersection &&
										!state.intersection.goingToIntersection) {
										var meters = Math.round(distance);
										var dt = null;
										var st = Q.getObject([closest.index, "instructions"], state.steps);
										if (meters < 999 && !(meters % 100) && st) {
											dt = meters + state.text.navigation.meter;
										} else if (meters > 999 && !(meters % 1000) && st) {
											meters = meters / Math.pow(10, meters.toString().length - 1);
											dt = meters.toFixed(1) + state.text.navigation.kilometr;
										}
										if (dt) {
											state.speech.speechFarManeuver = false;
											Q.Audio.speak(state.text.navigation.speechFarManeuver.interpolate({
												distance: dt,
												maneuver: st
											}));
										}
									}

									// update the meters to intersection at top menu
									if (!state.intersection.arrivedToIntersection) {
										var meters = Math.round(distance);
										// determine is it meter or kilometer
										if (meters != 0 && meters < 99 && !(meters % 10)) {
											state.topMenu.$distance.html(meters + ' ' + state.text.navigation.meter);
										} else if (meters != 0 && meters < 999 && !(meters % 100)) {
											state.topMenu.$distance.html(meters + ' ' + state.text.navigation.meter);
										} else if (meters > 999) {
											meters = meters / Math.pow(10, meters.toString().length - 1);
											state.topMenu.$distance.html(meters.toFixed(1) + ' ' + state.text.navigation.kilometr);
										}
									}

									// speech when approaching the intersection
									if (speed && (distance / speed) <= state.distance.secondsToSpeech &&
										!state.intersection.goingToIntersection &&
										!state.intersection.arrivedToIntersection) {
										var st = Q.getObject([closest.index, "instructions"], state.steps);
										if (st) {
											Q.Audio.speak(st.replace(/<\/?[^>]+(>|$)/g, ""));
											state.intersection.goingToIntersection = distance;
										}
									}
									if (state.intersection.goingToIntersection) {
										// waiting to arrive to the intersection
										if (closest.fraction > 0.9) {
											state.intersection.goingToIntersection = false;
											state.intersection.arrivedToIntersection = true;
										}
										// driver goes back
										else if (distance > state.intersection.goingToIntersection) {
											state.intersection.goingToIntersection = false;
										}
										//driver goes back from up to half of the route
										else {
											state.intersection.goingToIntersection = distance;
										}
									}
									// actions after turn
									if (state.intersection.arrivedToIntersection &&
										!state.intersection.goingToIntersection &&
										closest.fraction &&
										closest.fraction < state.distance.afterTurn &&
										state.steps.length) {
										// Set the next closest intersection information to top menu
										var distanceValue = Q.getObject([closest.index - 1, "distanceValue"], state.steps);
										if (distanceValue) {
											if (distanceValue - (distanceValue % 100) < 1000 && distanceValue - (distanceValue % 100) > 0) {
												state.topMenu.$distance.html(distanceValue - (distanceValue % 100) + ' ' + state.text.navigation.meter);
											} else {
												var distanceText = Q.getObject([closest.index - 1, "distanceText"], state.steps);
												if (distanceText) {
													state.topMenu.$distance.html(distanceText);
												}
											}
										}
										var maneuver = (state.steps[closest.index].maneuver && state.steps[closest.index].maneuver != '') ? Q.url("{{Travel}}/img/turns/" + state.steps[closest.index].maneuver + ".png") : Q.url("{{Travel}}/img/turns/straight.png")
										state.topMenu.$maneuver.css({
											"background-image": "url(" + maneuver + ")"
										});
										state.topMenu.$from.html(state.steps[closest.index].instructions.match(/.+(<b>.+<\/b>)/)[1]);
										for (var j = 0; j < closest.index; j++) {
											$('tr[data-step-index='+ j +']').remove();
										}
										state.speech.speechFarManeuver = true;
										state.intersection.arrivedToIntersection = false;
									}
									if (closest.index == state.steps.length - 1 && closest.fraction == 1) {
										var distanceValue = Q.getObject([closest.index, "distanceValue"], state.steps);
										if (distanceValue) {
											if (distanceValue - (distanceValue % 100) < 1000 && distanceValue - (distanceValue % 100) > 0) {
												state.topMenu.$distance.html(distanceValue - (distanceValue % 100) + ' ' + state.text.navigation.meter);
											} else {
												var distanceText = Q.getObject([closest.index, "distanceText"], state.steps);
												if (distanceText) {
													state.topMenu.$distance.html(distanceText);
												}
											}
										}
										var maneuver = Q.url("{{Travel}}/img/turns/arrive.png");
										state.topMenu.$maneuver.css({
											"background-image": "url(" + maneuver + ")"
										});
										$('table.adp-directions').remove();
									}
								}

								if (i != 100) {
									i++;
									setTimeout(_moveMarker, 10);
								}
							}
						};

						// If driver exists
						if (state.driver) {
							// array of last few coordinates to calculate the speed
							var stepTime = [];
							// Gets a new position, if there is the route but the steps are not calculated, starts calculating
							state.intervalIds.geoLocationWatchId =
								navigator.geolocation.watchPosition(
									handlePosition,
									function (error) {
										console.warn(error);
									}, {
										enableHighAccuracy: true, // need to set true to make it work consistently, it doesn't seem to make it any more accurate
										timeout: 5000,
										maximumAge: 0
									});
						}

						function handlePosition(position) {

							// Don't move if the distance to new coordinates are less than 3 meters
							if (Places.distance(state.center.lat, state.center.lng, position.coords.latitude, position.coords.longitude) <= 3) {
								return;
							}

							if (state.mapTool.state.directions) {
								if (state.mapTool.state.directions.status == 'OK' && !state.steps.length) {
									// Add intersections to state.steps
									tool.setIntersections(state.mapTool.state.directions.routes[0].legs);
								}
							} else {
								tool.getAddress(state.center, function (text) {
									state.topMenu.$from.text(text);
								});
							}

							// remove the old coordinate
							if (stepTime.length >= 5) {
								stepTime.shift();
							}
							stepTime.push({
								x: position.coords.latitude,
								y: position.coords.longitude,
								t: new Date().getTime()
							});
							state.speed = tool.getSpeed(stepTime);

							// Smoothly move marker to the new position
							_transition(position.coords);
							Q.handle(state.onNewCoordinates, tool, [position.coords, state.heading]);
						}

						// Wait until whole map will be loaded
						google.maps.event.addListenerOnce(state.map, 'idle', function () {
							Q.handle(callback, tool);
							Q.handle(state.onRefresh, tool);
							// Set the tilt of map
							$(state.mapTool.element).find('div[tabindex=0]').css({'transform': 'rotateX(' + state.tilt + 'deg)'});
							if (!state.steps.length) {
								// Show the current street adress in top menu
								tool.getAddress(state.center, function (text) {
									state.topMenu.$from.text(text);
								});
							}
							// Configure bottom panel
							state.onRouteCreated.add(function () {
								// Store passengers to bottom panel
								var passengers = tool.getPassengersList() || [];
								for (var i = 0; i < passengers.length; i++) {
									tool.setBottomPanelItem(passengers[i].arrives, passengers[i].remaining, passengers[i].id);
								}
								// finish point
								var legs = state.mapTool.state.directions.routes[0].legs
								var lastPoint = legs[legs.length - 1];
								var currentTime = new Date(),
									calcTime = new Date(currentTime);
								calcTime.setMinutes(currentTime.getMinutes() + (lastPoint.duration.value / 60));
								var arrives = calcTime.getHours() + ":" + calcTime.getMinutes();
								var remaining = (lastPoint.distance.value < 1000) ? lastPoint.distance.value + " " + state.text.navigation.meter : lastPoint.distance.text
								tool.setBottomPanelItem(arrives, remaining);
							});
						});
					});
				};
			},

			/**
			 * Disables the map track behind the user
			 * @method disableCompass
			 * @param {Element} compass element
			 * @param {Boolean} resetMap if true will recenter the map, by state.center, after disabling the compass
			 */
			disableCompass: function (resetMap) {
				var tool = this;
				var state = tool.state;
				if (state.compass) {
					state.compassFollow = false;
					state.compass.dataset.state = 'disabled';
				}
				if (resetMap) {
					tool.rotate();
				}
			},

			/**
			 * Enables the map track behind the user
			 * @method enableCompass
			 * @param {Element} compass element
			 */
			enableCompass: function () {
				var tool = this;
				var state = tool.state;
				if (state.compass) {
					state.compassFollow = true;
					state.compass.dataset.state = 'enabled';
					tool.recenterMap(true);
					state.map.setZoom(state.zoom);
					tool.rotate();
				}
			},

			/**
			 * Move map to state.center
			 * @method recenterMap
			 * @param [skipAnimation=false] if true will re-center without animation
			 */
			recenterMap: function (skipAnimation) {
				var state = this.state;
				if (skipAnimation) {
					state.map.panTo(state.center)
				} else {
					state.map.setCenter(state.center)
				}
				if (state.reCenter) {
					$(state.reCenter).hide();
				}
			},

			/**
			 * Recognize the text of your speech and appends to element
			 * @method speechRecognition
			 * @param {Element} elem to witch will return result
			 */
			speechRecognition: function (elem) {
				var tool = this;
				var state = tool.state;
				if (tool.recognition) {
					tool.recognition.stop();
					var light = 1;
					state.intervalIds.speechIndicator = setInterval(function () {
						if (light) {
							light = 0;
						} else {
							light = 1;
						}
						elem.style.opacity = light;
					}, 500);
					tool.recognition.onresult = function (event) {
						for (var i = 0; i < event.results.length; i++) {
							state.search.value = state.search.value + event.results[i][0].transcript;
						}
						state.search.focus();
					}
					tool.recognition.onend = function () {
						clearInterval(state.intervalIds.speechIndicator);
						light = 1;
						elem.style.opacity = light;
					}
					tool.recognition.start();
				} else {
					$(elem).attr('src', Q.url('{{Travel}}/img/speech_disabled.png'));
					console.warn('Travel/navigation: speechRecognition not supported in this device');
				}
			},

			/**
			 * Get the street name and append to element
			 * @method getAddress
			 * @param {Places.Coordinates} latLng coordinates of which you want to get address
			 */
			getAddress: function (latLng, callback) {
				var tool = this;
				var state = tool.state;
				if (latLng) {
					state.geocoder.geocode({'location': latLng}, function (results, status) {
						if (status == 'OK') {
							Q.handle(callback, tool, [Q.getObject(["0", "address_components", "1", "short_name"], results)]);
						}
					})
				}
			},

			/**
			 * Rotates the map by state.heading with imitation of 3D
			 * @method rotate
			 */
			rotate: function (lat, lng) {
				var tool = this;
				var state = tool.state;
				var mapel = state.mapTool.element;
				var el = {
					map: $('div[tabindex=0]', mapel),
					markers: $('div[data-info=markers]', mapel).find('img').not('[src="' + state.driver.icon.url + '"], [src*="dd-via.png"]'),
					driver: $('div[data-info=markers]', mapel).find('img[src="' + state.driver.icon.url + '"]'),
					compass: $('div[name=compass] img', tool.element)
				};
				var currentHeading = state.heading;
				if (lat && lng) {
					state.heading = _generateHeading(currentHeading, Places.heading(state.center.lat, state.center.lng, lat, lng));
					var transition = 'transform 0.5s ease';
				} else {
					state.heading = state.heading % 360;
					var transition = 'none';
				}
				if (state.compassFollow) {
					// Map
					el.map.css({
						'transition': transition,
						'transform': 'rotateX(' + state.tilt + 'deg) rotateZ(' + -state.heading + 'deg)'
					});

					// All markers except driver's
					el.markers.css({
						'transform-origin': '50% 100%',
						'transition': transition,
						'transform': 'rotate(' + state.heading + 'deg)'
					}).parent().css({
						'overflow': 'visible'
					});

					// Driver marker
					el.driver.css({
						'transform-origin': '50% 50%',
						'transition': transition,
						'transform': 'rotateZ(' + state.heading + 'deg)'
					});

					// Compass
					el.compass.css({
						'transition': transition,
						'transform': 'rotateZ(' + state.heading + 'deg)'
					});

					// 3D avatar markers
					if (Object.keys(state.mapTool.$avatars).length) {
						var keys = Object.keys(state.mapTool.$avatars)
						for (var i = 0; i < keys.length; i++) {
							if (state.mapTool.$avatars[keys[i]].attr('data-status') == 'passenger') {
								state.mapTool.$avatars[keys[i]].css({
									'transform': 'rotate(' + state.heading + 'deg)  translate(0px, -44px)',
									'transform-origin': '50% 50%',
									'transition': transition
								});
							} else {
								state.mapTool.$avatars[keys[i]].css({
									'transform': 'rotate(' + state.heading + 'deg)',
									'transform-origin': '50% 50%',
									'transition': transition
								});
							}
						}
					}
					if ($(state.reCenter).is(":visible")) {
						$(state.reCenter).hide();
					}
				} else {
					// Map
					el.map.css({
						'transition': 'none',
						'transform': 'rotateX(' + state.tilt + 'deg) rotateZ(0deg)'
					});

					// All markers except driver's
					el.markers.css({
						'transform-origin': '50% 100%',
						'transition': 'none',
						'transform': 'rotate(0deg)'
					});

					// Driver's marker
					el.driver.css({
						'transform-origin': '50% 50%',
						'transition': transition,
						'transform': 'rotate(' + state.heading + 'deg)'
					});

					// 3D avatar markers
					if (Object.keys(state.mapTool.$avatars).length) {
						var keys = Object.keys(state.mapTool.$avatars)
						for (var i = 0; i < keys.length; i++) {
							if (state.mapTool.$avatars[keys[i]].attr('data-status') == 'passenger') {
								state.mapTool.$avatars[keys[i]].css({
									'transition': 'none',
									'transform': 'rotate(0deg) translate(0px, -44px)',
									'transform-origin': '50% 50%'
								});
							} else {
								state.mapTool.$avatars[keys[i]].css({
									'transition': 'none',
									'transform': 'rotate(0deg)',
									'transform-origin': '50% 50%'
								});
							}
						}
					}
				}

				/**
				 * Generates the heading for short way turn
				 * @param cH current heading
				 * @param nR new heading
				 * @returns {number|*}
				 * @private
				 */
				function _generateHeading(cH, nR) {
					var aR;
					cH = cH || 0; // if rot undefined or 0, make 0, else rot
					aR = cH % 360;
					if (aR < 0) {
						aR += 360;
					}
					if (aR < 180 && (nR > (aR + 180))) {
						cH -= 360;
					}
					if (aR >= 180 && (nR <= (aR - 180))) {
						cH += 360;
					}
					cH += (nR - aR);
					return cH
				}
			},

			/**
			 * Used to add a cursor to user avatar to show the heading of driver
			 * or if passenger will point down (current location)
			 * Used with addAvatar method.
			 * @method addCursor
			 * @param {String} userId of which user you want to add the cursor
			 * @param {Boolean} passenger if false it will be considered as a driver
			 * @param {Function} callback
			 */
			addCursor: function (userId, passenger, callback) {
				var tool = this;
				var state = tool.state;
				var user = Q.Tool.byId(tool.prefix + 'Travel_map-navigation_Users_avatar_' + userId);
				if (user && user.element) {
					var elem = user.element;
					var cursor = document.createElement('img');
					cursor.src = Q.url('{{Travel}}/img/cursor.png');
					cursor.className = 'Travel_navigation_user_cursor';
					if (passenger) {
						$(elem).attr('data-status', 'passenger');
						$(cursor).attr('data-status', 'passenger');
						var shadow = document.createElement('div');
						shadow.className = 'Travel_navigation_passenger_shadow';
						elem.append(shadow)
					} else {
						$(elem.parentElement).addClass('Travel_navigation_driver_shadow');
						$(cursor).attr('data-status', 'driver');
						$(elem).attr('data-status', 'driver');
					}
					elem.append(cursor);
					Q.handle(callback, tool);
				} else {
					console.warn('Travel/navigation: no avatar founded with such userId')
				}
			},

			/**
			 * Add a 3D imitated user avatar tool on the map
			 * @method addAvatar
			 * @param {String} userId of which user you want to add to the map
			 * @param {Places.Coordinates} coordinates
			 * @param {Boolean} passenger if false it will be considered as a driver
			 * @param {Function} callback
			 */
			addAvatar: function (userId, coordinates, passenger, callback) {
				var tool = this;
				var state = tool.state;
				state.mapTool.addAvatar(userId, coordinates, function (callback) {
					if (state.centeredAvatars) {
						return;
					}
					var pipe = Q.pipe(['cursorAdded', 'avatarLoaded'], function () {
						Q.handle(state.onAvatardAdded, tool);
						Q.handle(callback, tool);
					});
					state.intervalIds[userId] = setInterval(function () {
						if (!callback.element.classList.contains('Q_loading')) {
							clearInterval(state.intervalIds[userId]);
							pipe.fill('avatarLoaded')();
							tool.addCursor(userId, passenger, function () {
								pipe.fill('cursorAdded')();
							});
						}
					}, 500);
				});
			},

			/**
			 * Toggling the Full-screen mode for Navigation tool
			 * @method toggleFullScreen
			 */
			toggleFullScreen: function () {
				var tool = this;
				var state = tool.state;
				if (state.fullScreen.toggled) {
					$(dashboard_slot).removeAttr("fullScreenToggled");
					$(page).removeAttr("pageFullScreenToggled");
					$(state.fullScreen.UI).removeAttr('data-fullScreen');
					$(tool.element).removeAttr('data-fullScreen');

					// returning the saved style to tool
					$(tool.element).css({
						position: state.fullScreen.position,
						width: state.fullScreen.width,
						height: state.fullScreen.height,
						top: state.fullScreen.top,
						left: state.fullScreen.left
					});
					state.fullScreen.toggled = false;
					Q.handle(state.onFullScreen, tool, [0]);
				} else {
					$(dashboard_slot).attr("fullScreenToggled", true);
					$(page).attr("pageFullScreenToggled", true);
					$(state.fullScreen.UI).attr('data-fullScreen', 'on');
					$(tool.element).attr('data-fullScreen', 'on');

					// backup the style of tool to rollback
					state.fullScreen.width = tool.element.style.width;
					state.fullScreen.height = tool.element.style.height;
					state.fullScreen.top = tool.element.style.top;
					state.fullScreen.left = tool.element.style.left;
					state.fullScreen.position = tool.element.style.position;

					// making the tool filled in the window
					$(tool.element).css({
						width: window.innerWidth + 'px',
						height: window.innerHeight + 'px'
					});

					state.fullScreen.toggled = true;
					Q.handle(state.onFullScreen, tool, [1]);
				}
			},

			/**
			 * Set the intersections to state.steps with needed values from given route legs
			 * @method setIntersections
			 * @param {Array} legs of route
			 */
			setIntersections: function (legs) {
				var state = this.state;
				state.steps = [];
				for (var i = 0; i < legs.length; i++) {
					var steps = legs[i].steps;
					for (var j = 0; j < steps.length; j++) {
						var nextSegment = steps[j].path;
						state.steps.push({
							x: steps[j].start_location.lat(),
							y: steps[j].start_location.lng(),
							instructions: steps[j].instructions,
							maneuver: steps[j].maneuver,
							distanceText: steps[j].distance.text,
							distanceValue: steps[j].distance.value,
							durationText: steps[j].duration.text,
							durationValue: steps[j].duration.value
						});
					}
				}
			},

			/**
			 * Get the passengers alternately list
			 * @method getPassengersList
			 * @returns {Array} with objecest sorted alternately {id, place, arrvies, remaining}
			 */
			getPassengersList: function () {
				var tool = this;
				var state = tool.state;
				var map = state.mapTool;
				// check for passengers
				if (!Object.keys(map.markers).length) {
					return;
				}
				// check for route directions
				if (!map.state.directions) {
					return;
				}
				var result = [];
				var legs = map.state.directions.routes[0].legs;
				for (var i = 1; i < legs.length; i++) {
					var aPoint = map.state.directions.routes[0].legs[i - 1];
					var bPoint = map.state.directions.routes[0].legs[i];
					var pClosest = null;
					var distance = null;

					for (var passenger in map.markers) {
						// passanger distance to bPoint
						var pDistance = Places.distance(
							map.markers[passenger].position.lat(),
							map.markers[passenger].position.lng(),
							bPoint.start_location.lat(),
							bPoint.start_location.lng()
						);
						if (distance === null) {
							distance = pDistance;
							pClosest = passenger;
						} else if (pDistance < distance) {
							// if the current passenger closer to current point then previous passenger
							distance = pDistance;
							pClosest = passenger;
						}
					}
					if (!pClosest) {
						continue;
					}
					distance = Places.distance(
						state.center.lat,
						state.center.lng,
						map.markers[pClosest].position.lat(),
						map.markers[pClosest].position.lng()
					);

					var remaining = (distance >= 1000) ? (distance / 1000).toFixed(1) + " " + state.text.navigation.kilometr : Math.ceil(distance) + " " + state.text.navigation.meter;
					var minutes = null;
					if (state.speed && state.speed.mps) {
						minutes = (distance / state.speed.mps) / 60;
					} else {
						minutes = aPoint.duration.value / 60;
					}
					var currentTime = new Date(),
						calcTime = new Date(currentTime);
					calcTime.setMinutes(currentTime.getMinutes() + minutes);
					var arrives = calcTime.getHours() + ":" + calcTime.getMinutes();

					result.push({
						id: pClosest,
						place: i,
						arrives: arrives,
						remaining: remaining
					})
				}
				return result;
			},

			/**
			 * Update the passengers alternately list
			 * @method updatePassengerList
			 */
			updatePassengerList: function () {
				var tool = this;
				var state = tool.state;
				var passengers = tool.getPassengersList();
				if (passengers) {
					for (var i = 0; i < passengers.length; i++) {
						var prefix = "bottom_menu_avatar_" + passengers[i].id;
						var avatar = Q.Tool.byId(prefix);
						if (!avatar) {
							continue;
						}
						avatar = avatar.element;
						var listItems = avatar.closest('tr');
						$('.Travel_navigation_bottom_menu_arrival_time', listItems).text(passengers[i].arrives);
						$('.Travel_navigation_bottom_menu_remaining_dist', listItems).text(passengers[i].remaining);
					}
				}
				// update end point
				if (!state.mapTool.state.directions) {
					return;
				}
				var legs = state.mapTool.state.directions.routes[0].legs
				var lastPoint = legs[legs.length - 1];
				var listItems = tool.$(".Travel_navigation_bottom_menu tr").last();
				var distance = Places.distance(
					state.center.lat,
					state.center.lng,
					lastPoint.end_location.lat(),
					lastPoint.end_location.lng()
				);

				var remaining = (distance >= 1000) ? (distance / 1000).toFixed(1) + " " + state.text.navigation.kilometr : Math.ceil(distance) + " " + state.text.navigation.meter;
				var minutes = null;
				if (state.speed && state.speed.mps) {
					minutes = (distance / state.speed.mps) / 60;
				} else {
					minutes = lastPoint.duration.value / 60;
				}
				var currentTime = new Date(),
					calcTime = new Date(currentTime);
				calcTime.setMinutes(currentTime.getMinutes() + minutes);
				var arrives = calcTime.getHours() + ":" + calcTime.getMinutes();

				$('.Travel_navigation_bottom_menu_arrival_time', listItems).text(arrives);
				$('.Travel_navigation_bottom_menu_remaining_dist', listItems).text(remaining);
			},

			/**
			 * set the mode of the map
			 * @method setMapMode
			 * @param {String} mode of the map (fromCar, fromNorth, fullRoute)
			 */
			setMapMode: function (mode) {
				var tool = this;
				var state = tool.state;

				switch (mode) {
					case 'fromCar':
					case 1: {
						mode = 'fromCar';
						tool.enableCompass();
						if (state.rollBackIcon) {
							// rollback the icon
							state.driver.icon.url = state.rollBackIcon;
							// remove rollback
							delete state.rollBackIcon;
						}
						break;
					}
					case 'fromNorth':
					case 2: {
						mode = 'fromNorth';
						tool.disableCompass(true);
						if (state.rollBackIcon) {
							// rollback the icon
							state.driver.icon.url = state.rollBackIcon;
							// remove rollback
							delete state.rollBackIcon;
						}
						break;
					}
					case 'fullRoute':
					case 3: {
						mode = 'fullRoute';
						tool.disableCompass(true);
						// if route exists
						if (state.mapTool.state.directions) {
							var bounds = state.mapTool.state.directions.routes[0].overview_path;
							state.mapTool.resumeZoomToDestination(bounds);
							// zoom considering the 4x bigger size of map
							state.map.setZoom(state.map.getZoom() - 2);
							// hide re-center button
							if (state.reCenter) {
								$(state.reCenter).hide();
							}
							// backup icon to rollback
							state.rollBackIcon = state.driver.icon.url;
							state.driver.icon.url = Q.url("{{Travel}}/img/icon_car.png");
						}
						break;
					}
					default : {
						return false;
					}
				}
				tool.element.setAttribute('data-action', mode);
			},

			/**
			 * set the preloader of navigation
			 * @method preloader
			 */
			preloader: function () {
				var tool = this;
				var state = tool.state;
				$(tool.element).attr('data-loading', true);
				Q.Template.render("Preloader", {
					Q: Q.url('{{Q}}'),
					text: state.text.navigation.loadingNavigation
				}, function (err, html) {
					if (err) return;
					$(tool.element).html(html);
					$('.Travel_navigation_loading_content', tool.element).plugin('Q/textfill');
				});
			},

			/**
			 * Add or update passenger information in bottom panel
			 * @method setBottomPanelItem
			 * @param {String} arrives text
			 * @param {String} remaining text
			 * @param {String} passangerId or empty for finish point
			 */
			setBottomPanelItem: function (arrives, remaining, passangerId) {
				var tool = this;
				var state = tool.state;
				var prefix = 'bottom_menu_avatar_' + passangerId;
				// If information for passenger exists - edit
				if (Q.Tool.byId(prefix)) {
					var $this = Q.Tool.byId(prefix).element;
					var listElement = $this.closest('tr');
					if (listElement) listElement.remove();
					($this);
				}

				var $bmt = $('.Travel_navigation_bottom_menu table', tool.element);
				Q.Template.render("BottomMenuItem", {arrives: arrives, remaining: remaining}, function (err, html) {
					if (err) return;
					var $bm = $("div[name=bottomMenu]", tool.element);
					$bmt.append(html);
					var $as = $('.Travel_navigation_bottom_menu_avatar', tool.element).last();
					// set up arrive icon
					if (!passangerId) {
						$as.append('<img src=' + Q.url("{{Travel}}/img/turns/arrive.png") + '>');
						return;
					}
					// set up avatar by giden userId
					$("<div>").appendTo($as).tool("Users/avatar", {
						userId: passangerId,
						short: true
					}, prefix).activate(function () {
						$(this.element).attr('data-state', 'waiting');
					});
				});
			},

			/**
			 * Get the current speed of movement
			 * @method getSpeed
			 * @param {Array} stepTime an array of objects that contain "x", "y" and "t" properties
			 * @returns {Object} contains properties "mps", "fps", "kph", "mih"
			 */
			getSpeed: function (stepTime) {
				var speed = null;
				if (stepTime.length) {
					var x1, y1, x2, y2, t1, t2, dist, time_s;
					x1 = stepTime[0].x;
					y1 = stepTime[0].y;
					t1 = stepTime[0].t;
					x2 = stepTime[stepTime.length - 1].x;
					y2 = stepTime[stepTime.length - 1].y;
					t2 = stepTime[stepTime.length - 1].t;
					dist = Places.distance(x1, y1, x2, y2);
					time_s = t2 - t1;
					// meters per second
					var speed_mps = dist / (time_s / 1000);
					// feet per second
					var speed_fps = speed_mps * 3.281;
					// kilometer per hour
					var speed_kph = (speed_mps * 3600) / 1000;
					// miles per hour
					var speed_mih = speed_kph * 0.621;
					speed = {
						mps: Math.round(speed_mps),
						fps: speed_fps.toFixed(3),
						kph: Math.round(speed_kph),
						mih: speed_mih.toFixed(3)
					};
				}
				return speed;
			},

			Q: {
				beforeRemove: function () {
					var tool = this;
					var state = this.state;

					Q.Audio.stopSpeaking();
					navigator.geolocation.clearWatch(state.intervalIds.geoLocationWatchId);

					// stop all intervals in tool
					for (var interval in state.intervalIds) {
						clearInterval(state.intervalIds[interval]);
						state.intervalIds[interval] = null;
					}

					state.fullScreen.toggled = true;
					tool.toggleFullScreen();
				}
			}
		});

	Q.Template.set('Preloader',
		'<div class="Travel_navigation_loading" data-loading="on">'
		+ '  <div class="Travel_navigation_loading_content">'
		+ '    <img src="{{Q}}/img/throbbers/coolspinner_dark.gif" class="Travel_navigation_loading_throbber">'
		+ '    <span class="Travel_navigation_loading_text">{{text}}</span>'
		+ '  </div>'
		+ '</div>'
	);

	Q.Template.set('BottomMenuItem',
		'<tr>'
		+ '  <td class="Travel_navigation_bottom_menu_arrival">Arrives:'
		+ '    <div class="Travel_navigation_bottom_menu_arrival_time">{{arrives}}</div>'
		+ '  </td>'
		+ '  <td class="Travel_navigation_bottom_menu_remaining">Remaining:'
		+ '    <div class="Travel_navigation_bottom_menu_remaining_dist">{{remaining}}</div>'
		+ '  </td>'
		+ '  <td class="Travel_navigation_bottom_menu_avatar"></td>'
		+ '</tr>'
	);

	Q.Template.set('Travel/navigation',
		'{{{tool "Travel/map" "navigation" center = center}}}'
		+ '<div class="Travel_navigation_menu" name="menu">'
		+ '  <div class="Travel_navigation_menu_from_div" name="menuFromDiv">'
		+ '    <span class="Travel_navigation_menu_from" name="menuFrom"></span>'
		+ '  </div>'
		+ '  <div class="Travel_navigation_menu_arrow" name="maneuver">'
		+ '    <div class="Travel_navigation_menu_arrow_text" name="distance"></div>'
		+ '  </div>'
		+ '  <div class="Travel_navigation_menu_path" name="menuPath"></div>'
		+ '  <div class="Travel_navigation_menu_open" data-status="closed" name="menuOpen"></div>'
		+ '</div>'
		+ '{{#if search}}'
		+ '<div class="Travel_navigation_search" name="searchBut">'
		+ '  <img src={{Travel}}/img/search.png>'
		+ '</div>'
		+ '<div class="Travel_navigation_search_inp" name="searchInp">'
		+ '  <input type="text" placeholder="">'
		+ '  <img class="Travel_navigation_search_inp_close" name="searchClose" src={{Travel}}/img/close_arrow.png>'
		+ '  <img class="Travel_navigation_search_inp_speech" name="searchSpeech" src={{Travel}}/img/speech.png>'
		+ '</div>'
		+ '{{/if}}'
		+ '{{#if compass}}'
		+ '<div class="Travel_navigation_compass" name="compass">'
		+ '  <img src={{Travel}}/img/map_compass.png>'
		+ '</div>'
		+ '{{/if}}'
		+ '{{#if reCenter}}'
		+ '<div class="Travel_navigation_re-center" name="reCenter">'
		+ '  <div class="Travel_navigation_re-center_UI">'
		+ '    <div class="Travel_navigation_re-center_text">'
		+ '      <img src={{Travel}}/img/map_arrow.png>'
		+ '      {{reCenterText}}'
		+ '    </div>'
		+ '  </div>'
		+ '</div>'
		+ '{{/if}}'
		+ '{{#if fullScreen}}'
		+ '<div class="Travel_navigation_fullScreen" data-fullscreen="on" name="fullScreen"></div>'
		+ '{{/if}}'
		+ '{{#if bottomMenu}}'
		+ '<div class="Travel_navigation_backdrop" name="backdrop"></div>'
		+ '<div class="Travel_navigation_bottom_menu" data-state="closed" name="bottomMenu">'
		+ '  <div class="Travel_navigation_bottom_menu_toggler"></div>'
		+ '  <table cellpadding="10"></table>'
		+ '</div>'
		+ '{{/if}}'
	);

})(Q, Q.jQuery, window);
