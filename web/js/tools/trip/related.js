(function (Q, $, window, undefined) {
	var Streams = Q.Streams;
	var Travel = Q.Travel;

	/**
	 * Travel/trip/related tool.
	 * Renders a tool with related trips list
	 * @method Travel/trip/related
	 * @param {Object} [options] this is an object that contains parameters for this function
	 *   @param {String} options.publisherId The publisher id of category stream
	 *   @param {String} options.streamName The name of the stream of category stream
	 *   @param {String} options.tripType
	 *   @param {String} options.location Location defined by user
	 *   @param {Q.event} options.onLocationActivated Execute when included Places/location tool activated
	 */
	Q.Tool.define("Travel/trip/related", function _Travel_trip_related(options, preview) {
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

			//Q.addStylesheet('{{Travel}}/css/tripRelated.css', {slotName: 'Travel'});

			tool.refresh();
		},

		{
			publisherId: null,
			streamName: null,
			tripType: null,
			location: {},
			onLocationActivated: new Q.Event()
		},

		{
			refresh: function(){
				var tool = this;
				var state = this.state;

				// create box for trips list
				state.$tripsListElement = $("<div class='Travel_trip_related_list'>").appendTo(tool.element);

				// create title for Places/location tool
				var text = state.tripType === "Travel/to" ? state.text.trips.WhereToPick : state.text.trips.WhereToDrop;
				$("<h2>").text(text).appendTo(tool.element);

				// create Places/location tool
				state.$placesLocationElement = $("<div>").appendTo(tool.element);

				// ste Places/location tool
				tool.setLocation();
			},
			refreshTrips: function () {
				var tool = this;
				var state = tool.state;

				// if location didn't defined - try to get it from localstorage
				if(Q.isEmpty(state.location)){
					var location = localStorage.getItem(Travel.Trip.passengerLocation);

					try {
						location = JSON.parse(location);
					} catch(ex) {
						console.warn("Travel/trip/related: wrong passenger location format.");
						return;
					}

					if(Q.isEmpty(location)){
						console.warn("Travel/trip/related: passenger location required!");
						return;
					}

					state.location = location;
				}

				// clean box
				Q.each(Q.Tool.from(state.$tripsListElement), function(){
					console.log(this);
				});

				// add throbber
				state.$tripsListElement.html($("<img />").prop("src", Q.info.imgLoading));

				// request trips list from server and fill preview tools
				Q.req("Travel/trips", "list", function (err, response) {
					var msg;
					if (msg = Q.firstErrorMessage(err, response && response.errors)) {
						throw new Q.Error(msg);
					}

					// clean box
					state.$tripsListElement.empty();

					var slots = response.slots.list;

					// add Travel/trip/preview tool for each trip
					Q.each(slots, function (index, data) {
						$("<div>").appendTo(state.$tripsListElement).tool("Travel/trip/preview", {
								publisherId: data.publisherId,
								streamName: data.streamName
						}).activate();
					});
				}, {
					method: 'GET',
					fields: {
						publisherId: state.publisherId,
						streamName: state.streamName,
						tripType: state.tripType,
						location: state.location
					}
				});
			},
			setLocation: function(){
				var tool = this;
				var state = this.state;

				Q.activate(Q.Tool.setUpElement(state.$placesLocationElement[0], 'Places/location', {
					onChoose: function (geocode, context) {
						if (!geocode && !context) return;

						var loc = geocode || context;

						state.location.latitude = loc.latitude || geocode.lat();
						state.location.longitude = loc.longitude || geocode.lng();

						// set selected location to localStorage variable
						// to use it later in Travel/trip tool.
						localStorage.setItem(
							Travel.Trip.passengerLocation,
							JSON.stringify(state.location),
							{expires: 2592000000}
						);

						tool.refreshTrips();
					}
				}), function(){
					Q.handle(state.onLocationActivated, Q.Tool.from(state.$placesLocationElement[0], 'Places/location'));
				});
			}
		}
	);
})(Q, Q.jQuery, window);