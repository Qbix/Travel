(function (Q, $, window, undefined) {

	var Users = Q.Users;
	var Streams = Q.Streams;
	var Places = Q.Places;
	var Travel = Q.Travel;
	var Calendars = Q.Calendars;

	var _alreadyShownDialog = false;

	/**
	 * Travel Tools
	 * @module Travel-tools
	 * @main
	 */

	/**
	 * Used to manage a trip
	 * @class Travel trips
	 * @constructor
	 * @param {Object} [options]
	 *   @param {String} options.publisherId Publisher of stream to which trips will be related
	 *   @param {String} options.streamName Name of stream to which trips will be related
	 *   @param {Stream} options.categoryStream Category stream where trip streams should be related to.
	 *   @param {Number} [options.arriveTime] Optional Time when driver planning to arrive (Unix time)
	 *   @param {Places.Coordinates} [options.from] Optional default for Offer a Ride dialog.
	 *     You can pass anything that Places.Coordinates.from() accepts.
	 *   @param {Places.Coordinates} [options.to] Optional default for Offer a Ride dialog
	 *     You can pass anything that Places.Coordinates.from() accepts.
	 *   @param {Boolean} [options.returnTripExists] Flag indicated whether back trip already exist.
	 *   This need to on/off ability to offer back trip in composer. By default = true, which means
	 *   that by default ability to offer back trip is off.
	 *   @param {object} [options.recurring] Recurring object. If category event is recurring it shold be {period: "weekly", days: ["Sun", "Mon", ...]}
	 *   @param {number} [options.defaultArriveTime] defaults to now + 2 hours in seconds
	 *   @param {number} [options.defaultDepartTime] defaults to now + 15 minutes in seconds
	 *   @param {Q.Event} [options.onInvoke] Occurs when it's time to open a trip stream.
	 *     The first parameter is the trip stream, the second is whether it has just been created.
	 *   @param {Q.Event} [options.onCreate] Triggered when Travel/trip stream created
	 *   @param {Q.Event} [options.onChoose] Triggered when user select trip from list
	 *   @param {Q.Event} [options.onRelatedTo] Triggered when new trip related to category stream
	 */
	Q.Tool.define("Travel/trips", function (options) {
			var tool = this;
			var state = this.state;
			var $te = $(this.element);
			var isCategoryStream = Q.isPlainObject(state.categoryStream);

			// check hash for Travel.trips
			tool.checkHash();

			// set text
			Q.Text.get("Travel/content", function(err, result){
				var msg = Q.firstErrorMessage(err);
				if (msg) {
					return console.warn(msg);
				}

				state.text = result;
			});

			//console.log(Q.getObject([Q.Text.language, Q.Text.locale, "Travel.content"], Q.Text.collection));
			if (!isCategoryStream && !state.publisherId) {
				throw new Q.Error("Travel/trips: publisherId option is required");
			}
			if (!isCategoryStream && !state.streamName) {
				throw new Q.Error("Travel/trips: streamName option is required");
			}

			// need to know if user logged in
			state.userId = Users.loggedInUserId();

			// set attribute to reflect interface according to user logged or not
			$te.attr("data-userId", state.userId || "");

			// default value for attribute data-going
			// this attribute define which buttons to show
			$te.attr("data-going", "");

			// loading tool specific styles
			Q.addStylesheet('{{Travel}}/css/trips.css', {slotName: 'Travel'});

			if(isCategoryStream){ // if category stream defined
				tool.refresh();

				state.publisherId = state.categoryStream.fields.publisherId;
				state.streamName = state.categoryStream.fields.streamName;
			} else { // else get category stream
				// get the stream where trip stream should be related to and run refresh method
				Streams.get(state.publisherId, state.streamName, function (err) {
					var msg = Q.firstErrorMessage(err);
					if (msg) {
						throw new Q.Error(msg);
					}

					state.categoryStream = this;

					tool.refresh();
				});
			}

			Streams.Stream.onRelatedTo(state.publisherId, state.streamName).set(function(to, from){
				if(from.fromType !== "Travel/trip"){ // only for trip streams
					return;
				}

				Streams.get(from.fromPublisherId, from.fromStreamName, function (err) {
					var msg = Q.firstErrorMessage(err);
					if (msg) {
						throw new Q.Error(msg);
					}

					Q.handle(state.onRelatedTo, tool, [this]);
				});
			}, tool);

			// set trip stream onCancel event
			// refresh this tool for valid display
			Travel.Trip.onCancel.set(function(){
				tool.refresh();
			}, tool);

			// user join the trip
			Travel.Trip.onUserJoin.set(function(message){
				if(message.byUserId !== state.userId){
					return;
				}

				tool.refresh();
			});

			// user leave the trip
			Travel.Trip.onUserLeave.set(function(message){
				if(message.byUserId !== state.userId){
					return;
				}

				tool.refresh();
			});
		},

		{
			publisherId: null,
			streamName: null,
			categoryStream: null,
			arriveTime: null,
			from: null,
			to: null,
			returnTripExists: true,
			/* default arrive time in seconds = current time + 2 hours */
			defaultArriveTime: Q.getObject(["plugins", "Travel", "Trip", "arriveTime"], Q) || 7200, // 2 hours
			/* default depart time in seconds = current time + 15 minutes */
			defaultDepartTime: Q.getObject(["plugins", "Travel", "Trip", "departTime"], Q) || 900, // 15 minutes
			onInvoke: new Q.Event(),
			onRelatedTo: new Q.Event(),
			onCreate: new Q.Event(function(stream){
				var tool = this;
				var state = this.state;

				// after any trip created - refresh to show valid layout
				tool.refresh();

				Q.handle(state.onInvoke, tool, [stream]);
			}, "Travel/trips"),
			onChoose: new Q.Event()
		},

		{
			refresh: function () {
				var tool = this;
				var state = this.state;
				var $te = $(tool.element);

				// category stream where trip stream should related to
				var categoryStream = state.categoryStream;
				var location = Places.Location.fromStream(categoryStream);
				// set destination point
				state.to = {
					"latitude": location.latitude,
					"longitude": location.longitude,
					"venue": location.venue
				};

				// set valid arrive time
				// priority: 1 value from state, 2 if set startTime attribute of category stream, 3 current date + arriveTime constant from config
				state.arriveTime = parseInt(state.arriveTime)
					|| parseInt(categoryStream.getAttribute("startTime"))
					|| (Date.now()/1000 + state.defaultArriveTime);

				// set valid depart time
				state.departTime = parseInt(state.arriveTime) + state.defaultArriveTime;

				// default trip type
				state.tripType = Date.now()/1000 > state.arriveTime
					? "Travel/from"
					: "Travel/to";

				// request backend for user conditions about trips.
				// Whether user is a driver for some direction.
				// Whether user is a passenger for some direction.
				// It need to correct display tool.
				Q.req('Travel/trips', 'data', function (err, response) {
					var msg;
					if (msg = Q.firstErrorMessage(err, response && response.errors)) {
						console.warn("Travel/trips: " + msg);
						return false;
					}

					var slots = response.slots.data;
					var going = slots.driverTripTo || slots.driverTripFrom || slots.passengerTripTo || slots.passengerTripFrom ? "1" : "";
					var tripTo = slots.driverTripTo || slots.passengerTripTo;
					var tripFrom = slots.driverTripFrom || slots.passengerTripFrom;
					tool.passengerSubscribed = slots.passengerSubscribed;

					// save driver info to state to use it outside
					state.driverTripTo = slots.driverTripTo;
					state.driverTripFrom = slots.driverTripFrom;

					state.returnTripExists = !!slots.driverTripFrom;

					// detect whether user participated trip or not
					$te.attr("data-going", going);

					// detect whether user participated to TO trip
					$te.attr("data-tripToExist", tripTo ? "1" : "");

					// detect whether user participated to FROM trip
					$te.attr("data-tripFromExist", tripFrom ? "1" : "");

					Q.Template.render('Travel/trips/select', function (err, html) {
						$te.html(html).activate();

						// check whether locations complete format
						tool.checkLocation([state.to, state.from]);

						// need a ride button
						tool.$('.Travel_trips_need').on(Q.Pointer.fastclick, function () {
							tool.needRide();
							 return false;
						});

						// offer a ride button
						tool.$('.Travel_trips_offer').on(Q.Pointer.fastclick, function () {
							tool.composer();
							return false;
						});

						// trips FROM button
						tool.$('.Travel_trips_from').on(Q.Pointer.fastclick, function () {
							// if trip exist - run onInvoke
							if(tripFrom){
								// stream should be preloaded
								Streams.get(tripFrom.publisherId, tripFrom.streamName, function(){
									Q.handle(state.onInvoke, tool, [this]);
								});

								return;
							}

							// if no trips exist - ask whether need a ride or offer a ride?
							tool.selectNeedOffer("Travel/from");
						});

						// trips TO button
						tool.$('.Travel_trips_to').on(Q.Pointer.fastclick, function () {
							// if trip exist - run onInvoke
							if(tripTo){
								// stream should be preloaded
								Streams.get(tripTo.publisherId, tripTo.streamName, function(){
									Q.handle(state.onInvoke, tool, [this]);
								});

								return;
							}

							// if no trips exist - ask whether need a ride or offer a ride?
							tool.selectNeedOffer("Travel/to");
						});
					});
				}, {
					method: 'GET',
					fields: {
						publisherId: categoryStream.fields.publisherId,
						streamName: categoryStream.fields.name
					}
				});
			},
			/**
			 * Open dialog to select 'Need a Ride' or 'Offer a Ride'
			 * @method selectNeedOffer
			 * @param {string} tripType
			 */
			selectNeedOffer: function (tripType) {
				var tool = this;

				// if no trips exist - ask whether need a ride or offer a ride?
				Q.Dialogs.push({
					title: 'Need/Offer ?',
					removeOnClose: true,
					className: "Travel_trips_needoffer",
					template: {
						name: "Travel/trips/select"
					},
					onActivate: function (dialog) {
						$(".Travel_trips_going", dialog).remove();

						// need a ride button
						$('.Travel_trips_need', dialog)
						.on(Q.Pointer.fastclick, function () {
							tool.needRide(tripType);
						});

						// offer a ride button
						$('.Travel_trips_offer', dialog)
						.on(Q.Pointer.fastclick, function () {
							tool.composer(tripType);
						});
					}
				});
			},
			/**
			 * Open 'Need a Ride' dialog to select trip.
			 * @method needRide
			 * @param {string} tripType
			 */
			needRide: function (tripType) {
				var tool = this;
				var state = this.state;
				var suggestTripType = tripType || state.tripType;

				Q.Dialogs.push({
					title: 'Need a Ride',
					removeOnClose: true,
					className: "Travel_trips_related",
					template: {
						name: "Travel/trips/preview",
						fields: {
							throbber: Q.info.imgLoading,
							subscribed: tool.passengerSubscribed
						}
					},
					onActivate: function() {
						var $dialog = $(this);
						var relationSelect = $(".Travel_trips_tabs", $dialog);

						$dialog.attr("data-tripType", suggestTripType); // default trip type

						// set relation types selection tabs click event
						$("> span", relationSelect).on(Q.Pointer.fastclick, function () {
							var $this = $(this);
							var tripType = $this.attr("data-relation");

							// change dialog attribute and related layouts changes using css
							$dialog.attr("data-tripType", tripType);
						});

						// activate Travel/trip/related tool on each list item
						var locationTools = {}; // here will store both Places/location tools: to and from
						$(".Travel_trips_relatedTool", $dialog).each(function(){
							var $tripsRelatedToolElement = $(this);
							var tripType = $tripsRelatedToolElement.parent().attr("data-relation");

							$tripsRelatedToolElement.tool("Travel/trip/related", {
								publisherId: state.publisherId,
								streamName: state.streamName,
								tripType: tripType,
								onLocationActivated: function(){
									var locationTool = this;
									var state = locationTool.state;

									// collect Places/location tools to global var
									locationTools[locationTool.id] = locationTool;

									state.onChoose.set(function(){
										// if location empty - exit
										if(Q.isEmpty(state.location)){
											// set parent attr "locationSelected" to reflect submit buttons
											$tripsRelatedToolElement.closest(".Travel_trips_list").removeAttr("data-locationSelected");
											return;
										}

										// set parent attr "locationSelected" to reflect submit buttons
										$tripsRelatedToolElement.closest(".Travel_trips_list").attr("data-locationSelected", 1);

										var selectedElement = $(".Q_selected", locationTool.element);

										// select neighbor Places/location tool
										// and set state.location if null
										Q.each(locationTools, function(index, tool){
											if(tool.id === locationTool.id){ // skip self tool
												return;
											}

											if(tool.state.location !== null){ // skip if location already defined
												return;
											}

											// set location and refresh tool
											//tool.state.location = {latitude: state.location.lat(), longitude: state.location.lng()};
											tool.state.location = state.location;
											tool.stateChanged("location");

											// set selected element of neighbor Places/location tool
											var attrDataLocation = selectedElement.attr("data-location");
											if(attrDataLocation){ // selected something with "data-location" attribute (current location ot address)
												$("[data-location='" + attrDataLocation + "']", tool.element).addClass("Q_selected");
											}else{ // selected Places/location/preview tool
												var placesLocationPreview = Q.Tool.from(selectedElement, "Streams/preview");
												if(Q.typeOf(placesLocationPreview) === "Q.Tool"){
													// iterate all child "Streams/preview" tools
													tool.forEachChild("Streams/preview", function(){
														// compare by streamName
														if(this.state.streamName !== placesLocationPreview.state.streamName){
															return;
														}

														// same preview tool
														// mark as selected
														$(this.element).addClass("Q_selected");
													});
												}
											}
										});
									}, tool);
								}
							}).activate(function(){
								var relatedTool = this;

								// refresh related tool when new trip created
								state.onRelatedTo.set(function(stream){
									if(stream.getAttribute("type") !== tripType){
										return;
									}

									relatedTool.refreshTrips();
								}, relatedTool);
							});
						});

						// add subscribe and unsubscribe button handler
						$("button[name=subscribe], button[name=unsubscribe]", $dialog)
							.plugin('Q/clickable')
							.on(Q.Pointer.fastclick, function(){
								var $this = $(this);
								var type = $this.closest(".Travel_trips_list").attr("data-relation");
								var location = state.to;
								var name = $this.attr("name");
								var action = Travel.Trip[name];

								// disable click events
								$this.addClass("Q_working");

								action(type, location, function(err, response){
									var r = response && response.errors;
									var msg;

									// enable click event
									$this.removeClass("Q_working");

									if (msg = Q.firstErrorMessage(err, r)) {
										console.warn(msg);
										return false;
									}

									passengerSubscribed = (name === "subscribe" ? "true" : "false");

									if(passengerSubscribed === "true"){
										// set attribute to show appropriate notice
										$this.closest(".Travel_trips_subscribe").attr("data-processed", "subscribe");

										// register device to send notifications
										Travel.Trip.registerDevice();
									}else{
										// set attribute to show appropriate notice
										$this.closest(".Travel_trips_subscribe").attr("data-processed", "unsubscribe");

										// we don't need to unregister device, because user can
										// subscribe to other streams also, and if unregister device
										// user will no get any notifications inculding needed for other streams
										//Travel.Trip.unRegisterDevice();
									}

									$this.closest(".Travel_trips_subscribe").attr("data-subscribed", passengerSubscribed);
									//var slots = response.slots;
								});
							});
					}
				});
			},
			/**
			 * Check places objuects for complete format before send to server.
			 * Currently just checking for venue exist, if not - add one.
			 * @method checkLocation
			 * @param {object|array} places Place object {latitude: [float], longitude: [float], venue: [string]}, or array
			 * of these objects
			 * @param {function} callback Execute on each of places objects when checking complete. Get location object
			 * as  context and err as argument.
			 */
			checkLocation: function(places, callback){
				if(!Q.isArrayLike(places)){
					places = [places];
				}

				// check whether places complete format
				// if venue don't exist - add one
				Q.each(places, function(){
					var location = this;

					// if location not an object - exit
					if(!Q.isPlainObject(location)){
						Q.handle(callback, location, ["location is not an object"]);
						return;
					}

					// if venue already defined - exit
					if(!Q.isEmpty(location.venue)){
						Q.handle(callback, location, [null]);
						return;
					}

					// get venue from google
					Places.Coordinates.from(location).geocode(function (err, results) {
						if(Q.isEmpty(results)){
							return;
						}

						// set venue to address
						location.venue = results[0].formatted_address;
						Q.handle(callback, location, [null]);
					});
				});
			},
			/**
			 * Trip creation process.
			 * @method composer
			 * @param {string} tripType Trip type (Travel/to, Travel/from). If this argument defined - only this trip
			 * type possible. There is no choice.
			 */
			composer: function (tripType) {
				var tool = this;
				var state = this.state;
				var suggestTripType = tripType || state.tripType;
				var fromPlace = state.from;
				var toPlace = state.to;

				// create amount of passengers element
				var $peopleMax = $('<select name="peopleMax" />');
				Q.each(1, 10, function (i) {
					$peopleMax.append($('<option ' + (i === 4 ? 'selected="selected"' : "") + ' />', {value: i}).html(i));
				});

				// create max available detour time element
				var $detourMax = $('<input type="number" name="detourMax" value="60" />');
				var $detourType = $('<select name="detourType" />');
				var distVal = Places.units[Places.metric ? 'kilometers' : 'miles'];
				$detourType.append($('<option />', {value: "minutes"}).html("Minutes"));
				$detourType.append($('<option />', {value: distVal}).html(distVal));

				// create composer dialog
				var offerRide = (state.text.OfferRide || 'Offer a Ride');
				Q.Dialogs.push({
					title: offerRide,
					className: "Travel_trips_composer",
					template: {
						name: 'Travel/trips/composer',
						fields: {
							fromPlace: fromPlace,
							toPlace: toPlace,
							peopleMax: $peopleMax[0].outerHTML,
							detourMax: $detourMax[0].outerHTML + $detourType[0].outerHTML
						}
					},
					onActivate: function () {
						var $dialog = $(this);
						// need to set correct z-index to show correct pickadate
						var dialogZindex = parseInt($dialog.css("z-index")) || 0;
						var $labels = $('select[name=labels]', $dialog);
						var $detourMax = $('input[name=detourMax]', $dialog);
						var $detourType = $('select[name=detourType]', $dialog);
						var $peopleMax = $('select[name=peopleMax]', $dialog);
						var $arriveTimeDay = $("input[name=arriveTimeDay]", $dialog);
						var $arriveTime = $("select[name=arriveTime]", $dialog);
						var $departTimeDay = $("input[name=departTimeDay]", $dialog);
						var $departTime = $("select[name=departTime]", $dialog);
						var $offerTripTo = $("input[name=offerTripTo]", $dialog);
						var $offerTripFrom = $("input[name=offerTripFrom]", $dialog);
						var $actionsDiv = $('.Travel_trips_share', $dialog);
						var $submitButton = $("button.Travel_trips_share_button", $actionsDiv);

						// get recurring participant extra of current user
						var userRecurring = {};
						var categoryRecurring = {};
						Calendars.Recurring.getRecurringData(state.categoryStream, function(data){
							categoryRecurring = data.eventRecurring || {};

							if (data.userRecurring) {
								// days = trips days or events days
								userRecurring = data.userRecurring || {};
							}

							$(".Travel_trips_recurring_tr", $dialog).show();
						});

						// fill labels
						Users.getLabels(state.userId, 'Users/', function (err, labels) {
							Q.each(labels, function () {
								$labels.append($('<option />', {value: this.label}).html(this.title));
							});
						});

						// this attribute need to disable ability to "add back trip too"
						$dialog.attr("data-returnTripExists", state.returnTripExists);

						// set pickadate plugin
						Q.addStylesheet(
							['{{Q}}/pickadate/themes/default.css', '{{Q}}/pickadate/themes/default.date.css'],
							{slotName: 'Q'}
						);
						Q.addScript(['{{Q}}/pickadate/picker.js', '{{Q}}/pickadate/picker.date.js'], function () {
							var _onOpen = function () {
								var currentZindex = parseInt(this.$root.css("z-index")) || 0;
								if (currentZindex > dialogZindex) return;
								this.$root.css("z-index", dialogZindex + 1);
							};

							// hide earlier times in time select elements
							var _onSet = function () {
								var pickaDate = this;
								var $day = pickaDate.$node;
								var $pickaTime = $("select", $day.parent());

								// if day cleared - disable time selector
								if (!$day.val()) {
									$pickaTime.val(false);
									$pickaTime.prop("disabled", true);
									return;
								}

								$pickaTime.prop("disabled", false);

								var dayVal = pickaDate.get("select");
								dayVal = [dayVal.year, dayVal.month, dayVal.date];
								var now = new Date();
								$pickaTime.find('option').show();
								if (now.getFullYear() !== dayVal[0]
									|| now.getMonth() !== dayVal[1]
									|| now.getDate() !== dayVal[2]) {
									return;
								}
								var hours = now.getHours();
								var minutes = now.getMinutes();
								$pickaTime.find('option').each(function () {
									var $option = $(this);
									var parts = $option.attr('value').split(':').map(function (element) {
										return parseInt(element, 10);
									});
									if (parts[0] < hours
										|| (parts[0] === hours && parts[1] <= minutes)) {
										var $selected = $option.nextAll().eq(12);
										if (!$selected.length) {
											$selected = $option.nextAll().last();
										}
										//$pickaTime.val($selected.attr('value'));
										$option.hide();
									}
								});
							};

							/**
							 *
							 * @method _setDateTimeElements
							 * @param {number} selectedTime time in seconds
							 * @param {object} $timeElement jquery object
							 * @param {object} $dateElement jquery object
							 */
							var _setDateTimeElements = function (selectedTime, $timeElement, $dateElement) {
								// set time selection elements
								var timeDay = new Date();

								// if selectedTime - seconds, turn it to milliseconds
								timeDay / selectedTime >= 10 ? selectedTime *= 1000 : "";

								timeDay.setTime(selectedTime); // setTime method to avoid timezone correction
								var time = timeDay.toLocaleTimeString('en-US', {
									hour: '2-digit',
									minute: '2-digit',
									hour12: false
								});

								// these temporary vars need to detect selected time independ of time step selected
								// if arriveTime="12:15AM", nArriveTime=1215.
								var nTime = parseInt(time.replace(/\D/g, ''));
								var timeSelected;

								// set departTime and arriveTime list
								Q.each(tool.getTimes(), function (key, val) {
									// create option html element
									var $option = $("<option>").val(key).text(val);

									// get number from "12:30AM" -> 1230
									var nKey = parseInt(key.replace(/\D/g, ''));

									// append option element to select element
									$timeElement.append($option.clone());

									// move selected time up till current iterated time not less selectedTime
									if (nKey >= nTime && !timeSelected) {
										timeSelected = key;
									}
								});

								// set time element value
								$timeElement.val(timeSelected);

								// set date element value
								$dateElement.pickadate({
									showMonthsShort: true,
									format: 'ddd, mmm d',
									formatSubmit: 'yyyy/mm/dd',
									hiddenName: true,
									min: new Date(),
									container: "body",
									onStart: function () {
										this.set('select', [
											timeDay.getFullYear(),
											timeDay.getMonth(),
											timeDay.getDate()
										]);
									},
									onOpen: _onOpen,
									onSet: _onSet
								}).on('focus', function () {
									$(this).blur();
								});
							};

							// set arrive date/time elements
							_setDateTimeElements(state.arriveTime - state.defaultDepartTime, $arriveTime, $arriveTimeDay);

							// set leave date/time elements
							_setDateTimeElements(state.departTime + state.defaultDepartTime, $departTime, $departTimeDay);
						});

						// set Places/location tools to appropriate elements
						$(".Travel_trips_loc_placesLocation", $dialog).each(function () {
							var $this = $(this);
							var direction = $this.attr("data-direction");
							var dataFor = $this.closest("tr").attr("data-for");
							var location;

							if (dataFor === "tripFrom") {
								if (direction === 'fromLocation') {
									location = toPlace;
								} else {
									location = fromPlace;
								}
							} else if (dataFor === "tripTo") {
								if (direction === 'fromLocation') {
									location = fromPlace;
								} else {
									location = toPlace;
								}
							}

							Q.activate(Q.Tool.setUpElement($this[0], 'Places/location', {
								location: location,
								onChoose: function (geocode, context) {
									var loc = geocode || context;

									// be sure that location contain latitude and longitude
									if (loc){
										loc.latitude = loc.latitude || geocode.lat();
										loc.longitude = loc.longitude || geocode.lng();
									}

									// set locations to state in form:
									// state.tripTo.toLocation, state.tripTo.fromLocation
									// state.tripFrom.toLocation, state.tripFrom.fromLocation
									Q.setObject(dataFor + '.' + direction, loc, state);

									// location integrity check
									tool.checkLocation(loc, function(err){
										if (err) {
											console.warn(err);
											return false;
										}

									});
								}
							}, [tool.prefix, direction, dataFor].join('-')));
						});

						$(".Travel_trips_recurring i.settings", $dialog).on(Q.Pointer.fastclick, function(){
							Calendars.Recurring.dialog({
								period: categoryRecurring.period,
								days: userRecurring.days || [],
								possibleDays: categoryRecurring.days,
								callback: function(days, startDate, endDate){
									userRecurring = {
										period: categoryRecurring.period,
										days: days,
										startDate: startDate,
										endDate: endDate
									};
								}
							});
						});

						// handle with "offer trip to", "offer trip from" checkboxes
						$($offerTripTo).add($offerTripFrom).off("change").on("change", function () {
							var $this = $(this);

							// if checked - add attribute to tool element, and remove one otherwise
							if ($this.prop("checked") === true) {
								$dialog.attr("data-" + $this.attr("name"), 1);
							} else {
								$dialog.removeAttr("data-" + $this.attr("name"));
							}

							// check if even one trip direction selected
							if ($offerTripTo.prop("checked") || $offerTripFrom.prop("checked")) {
								$dialog.attr("data-directionSelected", 1);
							} else {
								$dialog.removeAttr("data-directionSelected");
							}

							// Get names of location objects (toLocation, fromLocation) using currently
							// They can be different according to trip directions selected (tripTo, tripFrom or both)
							var dataFor = null;
							if ($offerTripTo.prop("checked")) {
								dataFor = "tripTo";
								suggestTripType = "Travel/to";
							} else if ($offerTripFrom.prop("checked")) {
								dataFor = "tripFrom";
								suggestTripType = "Travel/from";
							}

							// fieldNames - result location objects:
							// 	tripTo.fromLocation, tripTo.toLocation OR tripFrom.fromLocation, tripFrom.toLocation
							state.currentLocationsUsing = {
								"fromLocation": dataFor + '.fromLocation',
								"toLocation": dataFor + '.toLocation'
							};
						});

						// nevermind which tripType or suggestTripType = "Trip/from"
						// in both ways "Trip/to" can't be offered. So no trip type choice
						if (suggestTripType === "Travel/from") {
							// as we have only one trip type, set frontend interface as "Travel/to"
							$offerTripFrom.trigger("click");

							// we have just "Trip To", so no need checkboxes
							$(".Travel_trips_composer_selectTripType", $dialog).hide();

							// we need depart time for Travel/from
							$(".Travel_trips_loc_fromtoo", $dialog).css("position", "static");
						} else if (tripType === "Travel/to") {
							// if tripType="Travle/to" - no need to offer Trip type choice.
							// if tripType is null - offer trip type choice

							// as we have only one trip type, set frontend interface as "Travel/to"
							$offerTripTo.trigger("click");

							// we have just "Trip To", so no need checkboxes
							$(".Travel_trips_composer_selectTripType", $dialog).hide();
						}

						// submit button
						$submitButton
							.plugin('Q/clickable')
							.on(Q.Pointer.fastclick, function () {
								// disable share button
								// don't use data-disabled, because it using by _composerValidate
								$actionsDiv.attr("data-processing", true);

								var fromPlace = Q.getObject(Q.getObject("currentLocationsUsing.fromLocation", state), state);
								var toPlace = Q.getObject(Q.getObject("currentLocationsUsing.toLocation", state), state);

								fromPlace = {latitude: fromPlace.latitude, longitude: fromPlace.longitude, venue: fromPlace.venue};
								toPlace = {latitude: toPlace.latitude, longitude: toPlace.longitude, venue: toPlace.venue};

								/**
								 * Get unix time stamp from pickadate and time select element
								 * @method _getTime
								 * @param {object} $timeDayElement jquery element where pickadate plugin activated
								 * @param {object} $timeElement jquery element, select element with time
								 *
								 * @return number Unix timestamp (seconds from 1970)
								 */
								var _getTime = function ($timeDayElement, $timeElement) {
									var isElementInViewport = function($el){
										var rect = $el[0].getBoundingClientRect();

										return (
											rect.top >= 0 &&
											rect.left >= 0 &&
											rect.bottom <= $(window).height() &&
											rect.right <= $(window).width()
										);
									};

									if (!isElementInViewport($timeDayElement) || !isElementInViewport($timeElement)) {
										return null;
									}

									var pickadate = $timeDayElement.pickadate("picker");
									if (!pickadate) return null;

									var timeDay = pickadate.get("select");
									var timeHours = $timeElement.val().split(':');
									if (!timeHours) return null;

									var time = new Date(timeDay.year, timeDay.month, timeDay.date, timeHours[0], timeHours[1]);
									time = time.getTime() / 1000; // get unix time

									return time;
								};

								// get arrive time
								var arriveTime = _getTime($arriveTimeDay, $arriveTime);

								// get leave time
								var departTime = _getTime($departTimeDay, $departTime);

								var fields = {
									relateTo: {
										publisherId: state.categoryStream.fields.publisherId,
										streamName: state.categoryStream.fields.name
									},
									arriveTime: arriveTime,
									departTime: departTime,
									// this option have sense only if both directions offer
									// because if only one offer (any) - we create just one trip
									offerFromToo: $offerTripTo.prop("checked") && $offerTripFrom.prop("checked"),
									peopleMax: parseInt($peopleMax.val() || 0) + 1, // as only driver created trip - max people + driver
									detourMax: parseFloat($detourMax.val()) || 0,
									detourType: $detourType.val(),
									labels: $labels.val(),
									recurring: userRecurring
								};

								// create trip
								Travel.Trip.create(suggestTripType, fromPlace, toPlace, function (err, response) {
									var r = response && response.errors;
									var msg;
									if (msg = Q.firstErrorMessage(err, r)) {
										$actionsDiv.removeAttr("data-processing"); // enable share button
										Q.alert(msg);
										return false;
									}

									// get trip stream and execute onCreate event
									Streams.get(response.slots.stream.publisherId, response.slots.stream.name, function () {
										var stream = this;

										Q.Dialogs.pop();
										Q.handle(state.onCreate, tool, [stream]);
									});
								}, fields);

								return false;
							});

						/**
						 * Check if all conditions fine for share
						 * @method _composerValidate
						 * @return {bool}
						 */
						var _composerValidate = function () {
							var missing = false;

							var fieldNames = [
								Q.getObject("currentLocationsUsing.fromLocation", state),
								Q.getObject("currentLocationsUsing.toLocation", state)
							];

							// check if both directions set
							Q.each(fieldNames, function (i, fieldName) {
								if (!Q.getObject(fieldName, state)) {
									missing = true;
									return false;
								}
							});

							// if "offer from too" checked - leave time required
							if ($dialog.attr("data-offerTripTo") && $dialog.attr("data-offerTripFrom") && !$departTime.val()) {
								missing = true;
							}

							// if state.arriveTime didn't set - arrive time required
							var $arriveTime = $("select[name=arriveTime]:visible", $dialog);
							if ($arriveTime.length && !$arriveTime.val()) {
								missing = true;
							}

							if (missing) {
								// disable share button
								$actionsDiv.attr("data-disabled", true);

								return false;
							}

							// enable share button
							$actionsDiv.removeAttr("data-disabled");

							return true;
						};

						// validate composer every second
						// this timer terminated at Q.beforeRemove event (at the end)
						state.cvTimerId = window.setInterval(function () {
							_composerValidate();
						}, 1000);
					}
				});
			},
			/**
			 * Check location hash for trip stream need to load and fire onInvoke event if yes
			 * @method checkHash
			 */
			checkHash: function(){
				var tool = this;
				var state = this.state;
				var locationHash = window.location.hash;

				if(_alreadyShownDialog){
					return;
				}else{
					_alreadyShownDialog = true;
				}

				if(Q.isEmpty(locationHash) || locationHash.indexOf("Travel.trips=") === -1) {
					return;
				}

				var tripStream = locationHash.split('=')[1];
				if(Q.isEmpty(tripStream)){
					return;
				}

				tripStream = tripStream.split('/');
				Streams.get(tripStream[0], "Travel/trip/" + tripStream[1], function(err, data){
					var msg = Q.firstErrorMessage(err, data);
					if (msg) {
						console.warn(msg);
						return;
					}

					Q.handle(state.onInvoke, null, [this]);
				});
			},
			/**
			 * Create array of times in format [{"12:00": "12 AM"}, ...]
			 * @method getTimes
			 * @param {integer} interval Interval between hours in minutes (default 30)
			 * @return {object} Array
			 */
			getTimes: function (interval) {
				interval = interval || 15; //minutes interval

				var dt = new Date(1970, 0, 1, 0, 0, 0, 0),
					rc = {};
				var key, val;
				while (dt.getDate() === 1) {
					key = dt.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: false});
					val = dt.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true});
					rc[key] = val;
					dt.setMinutes(dt.getMinutes() + interval);
				}
				return rc;
			},
			Q: {
				beforeRemove: function () {
					// clear composer validation timer
					clearInterval(this.state.cvTimerId);
				}
			}
		});

	Q.Template.set('Travel/trips/select',
		'<div class="Travel_trips_buttons">' +
		'	<div class="Travel_trips_notGoing">' +
		'		<button class="Q_button Travel_trips_need">{{trips.NeedRide}}</button>' +
		'		<button class="Q_button Travel_trips_offer">{{trips.OfferRide}}</button>' +
		'	</div>' +
		'	<div class="Travel_trips_going">' +
		'		<button class="Q_button Travel_trips_to">{{trips.RideTo}}</button>' +
		'		<button class="Q_button Travel_trips_from">{{trips.RideFrom}}</button>' +
		'	</div>' +
		'</div>',
		{text: "Travel/content"}
	);

	Q.Template.set('Travel/trips/preview',
		'<div class="Travel_trips_tabs">' +
		'	<span class="Travel_trips_tab" data-relation="Travel/to">{{trip.to}}</span>' +
		'	<span class="Travel_trips_tab" data-relation="Travel/from">{{trip.from}}</span>' +
		'</div>' +
		'<div class="Travel_trips_content">'	 +
		'	<div class="Travel_trips_list" data-relation="Travel/to">' +
		'		<div class="Travel_trips_relatedTool"></div>' +
		'		<div class="Travel_trips_subscribe" data-subscribed="{{subscribed}}" data-processed="">' +
		'			<div class="Travel_trips_button_subscribe"><button name="subscribe" class="Q_button">{{trips.Subscribe}}</button></div>' +
		'			<div class="Travel_trips_button_unsubscribe"><button name="unsubscribe" class="Q_button">{{trips.Unsubscribe}}</button></div>' +
		'			<div class="Travel_trips_subscribe_notice">{{trips.locationSubscribeNotice}}</div>' +
		'			<div class="Travel_trips_unsubscribe_notice">{{trips.locationUnsubscribeNotice}}</div>' +
		'		</div>' +
		'	</div>' +
		'	<div class="Travel_trips_list" data-relation="Travel/from">' +
		'		<div class="Travel_trips_relatedTool"></div>' +
		'		<div class="Travel_trips_subscribe" data-subscribed="{{subscribed}}">' +
		'			<div class="Travel_trips_button_subscribe"><button name="subscribe" class="Q_button">{{trips.Subscribe}}</button></div>' +
		'			<div class="Travel_trips_button_unsubscribe"><button name="unsubscribe" class="Q_button">{{trips.Unsubscribe}}</button></div>' +
		'		</div>' +
		'	</div>' +
		'</div>',
		{text: "Travel/content"}
	);

	Q.Template.set('Travel/trips/composer',
		' <div class="Travel_trips_composer_selectTripType">'
		+ ' 	<div>{{trips.WhatToOffer}}</div>'
		+ '		<label class="Travel_trips_composer_offerTrip"><input type="checkbox" name="offerTripTo" value="tripTo"> {{trip.tripTo}}</label>'
		+ '		<label class="Travel_trips_composer_offerTrip"><input type="checkbox" name="offerTripFrom" value="tripFrom"> {{trip.tripFrom}}</label>'
		+ '	</div>'
		+ '		<table class="Travel_trips_loc">'
		+ '			<tr data-for="tripTo">'
		+ '				<th>{{trip.to}}:</th>'
		+ '			</tr>'
		+ '			<tr data-for="tripTo">'
		+ '				<td class="Travel_trips_loc_address"><div class="Travel_trips_loc_placesLocation" data-direction="toLocation"></div></td>'
		+ '			</tr>'
		+ '			<tr data-for="tripTo">'
		+ '				<th>{{trip.from}}:</th>'
		+ '			</tr>'
		+ '			<tr data-for="tripTo">'
		+ '				<td class="Travel_trips_loc_address"><div class="Travel_trips_loc_placesLocation" data-direction="fromLocation"></div></td>'
		+ '			</tr>'
		+ '			<tr data-for="tripFrom">'
		+ '				<th>{{trip.to}}:</th>'
		+ '			</tr>'
		+ '			<tr data-for="tripFrom">'
		+ '				<td class="Travel_trips_loc_address"><div class="Travel_trips_loc_placesLocation" data-direction="toLocation"></div></td>'
		+ '			</tr>'
		+ '			<tr data-for="tripFrom">'
		+ '				<th>{{trip.from}}:</th>'
		+ '			</tr>'
		+ '			<tr data-for="tripFrom">'
		+ '				<td class="Travel_trips_loc_address"><div class="Travel_trips_loc_placesLocation" data-direction="fromLocation"></div></td>'
		+ '			</tr>'
		+ '			<tr class="Travel_trips_loc_arriveTime" data-for="tripTo">'
		+ '				<th>{{trip.arriveTime}}: <select name="arriveTime"></select><input name="arriveTimeDay" /></th>'
		+ '			</tr>'
		+ '			<tr class="Travel_trips_loc_fromtoo" data-for="fromToo">'
		+ '				<th>{{trip.departTime}}: <select name="departTime"></select><input name="departTimeDay" /></th>'
		+ '			</tr>'
		+ '			<tr class="Travel_trips_recurring_tr">'
		+ '				<th>{{trips.Recurring}}:</th>'
		+ '			</tr>'
		+ '			<tr class="Travel_trips_recurring_tr">'
		+ '				<td class="Travel_trips_recurring"><i class="settings"></i></td>'
		+ '			</tr>'
		+ '			<tr>'
		+ '				<td colspan="2" class="Travel_trips_offer">'
		+ '{{trip.offerAtMostPeople}}: '
		+ '{{{peopleMax}}}&nbsp;<select name="labels"><option value="" selected="selected">{{trip.people}}</option></select>'
		+ '				</td>'
		+ '			</tr>'
		+ '			<tr>'
		+ '				<td colspan="2" class="Travel_trips_offer">'
		+ '{{trip.maxDetour}}: {{{detourMax}}}'
		+ '				</td>'
		+ '			</tr>'
		+ '			<tr>'
		+ '				<td colspan="2" class="Travel_trips_share">'
		+ '					<button class="Q_button Travel_trips_share_button">{{trip.share}}</button>'
		+ '				</td>'
		+ '			</tr>'
		+ '		</table>',
		{text: "Travel/content"}
	);

})(Q, Q.jQuery, window);