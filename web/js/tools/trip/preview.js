(function (Q, $, window, undefined) {
	var Users = Q.Users;
	var Streams = Q.Streams;
	var Places = Q.Places;
	var Travel = Q.Travel;

	/**
	 * Travel/trip/preview tool.
	 * Renders a tool to preview trips
	 * @method Travel/trip/preview
	 * @param {Object} [options] this is an object that contains parameters for this function
	 *   @param {String} options.publisherId The publisher id
	 *   @param {String} options.streamName The name of the stream
	 *   @param {Boolean} [options.hideIfMaxParticipants] If there participants=peopleMax in the trip, hide this preview.
	 */
	Q.Tool.define("Travel/trip/preview",
		function _Travel_trip_preview(options, preview) {
			var tool = this;
			var state = this.state;
			var $te = $(tool.element);
			preview = preview || Q.Tool.from($te, "Streams/preview");


			Q.addStylesheet('{{Travel}}/css/trip.css', {slotName: 'Travel'});

			// call onInvoke handler
			$te.off(Q.Pointer.fastclick)
			.on(Q.Pointer.fastclick, tool, function () {
				if(Q.isEmpty(Users.loggedInUser)){
					Q.alert("You should be logged in.");
					return;
				}

				Q.handle(state.onInvoke, tool, [preview]);
			});

			if (preview) {
				preview.state.onRefresh.add(this.refresh.bind(this));
			} else {
				tool.getStream(function(){
					tool.refresh(this);

					// remove tool on stream closed
					Travel.Trip.onCancel.set(function () {
						// if current stream closed - remove tool
						if(state.stream.fields.name === this.fields.name){
							tool.remove(false, true);
						}
					}, tool);

					// if stream changed - refresh tool
					this.onFieldChanged("").set(function(){
						tool.getStream(function(){
							tool.refresh(this);
						});
					});
				});
			}
		},

		{
			publisherId: null,
			streamName: null,
			hideIfMaxParticipants: true,
			onInvoke: new Q.Event(),
			templates: {
				view: {
					name: 'Travel/trip/preview',
					fields: {}
				}
			}
		},

		{
			refresh: function (stream, onLoad) {
				var tool = this;
				var $te = $(tool.element);
				var state = tool.state;
				state.stream = stream;
				var template = state.templates.view;
				var peopleMax = stream.getAttribute("peopleMax");

				/*if (state.hideIfMaxParticipants
					&& stream.fields.participatingCount == peopleMax) {
					$te.remove(); // remove because there is css :empty rule which show "No trips"
					return;
				}*/

				var participantsTool = Q.Tool.setUpElementHTML('div',
					'Streams/participants',
					{
						publisherId: stream.fields.publisherId,
						streamName: stream.fields.name,
						max: peopleMax,
						maxShow: peopleMax,
						invite: false
					}
				);
				Q.Text.get('Travel/content', function (err, text) {
					var startTime = parseInt(stream.getAttribute('startTime'));
					var endTime = parseInt(stream.getAttribute('endTime'));
					var tripState = stream.getAttribute('state') || "new";
					var type = stream.getAttribute('type');
					var showEndTime = (type === 'Travel/to' && endTime);
					var tp = text.trip.preview;
					var arrives = (tripState === 'completed') ? tp.Arrived : tp.Arrives;
					var departs = (tripState === 'new' ? tp.Departs : tp.Departed);
					var label = showEndTime ? arrives : departs;
					var status = 'basic32_clock';

					switch (tripState) {
						case 'started':
							status = 'basic32_right';
							break;
						case 'completed':
							status = 'basic32_check';
							break;
						case 'ended':
							status = 'basic32_cancel';
					}

					var fields = {
						status: status,
						title: '<span>' + stream.fields.title.replace(":", ':</span>'),
						participantsTool: participantsTool,
						label: label,
						"Q/timestamp": {
							time: showEndTime ? endTime : startTime
						}
					};
					Q.Template.render(
						template.name,
						fields,
						function (err, html) {
							if (err) return;
							$te.html(html).activate()
						}
					);
				});
			},
			getStream: function(callback){
				var tool = this;
				var state = this.state;

				Q.Streams.get(state.publisherId, state.streamName, function (err) {
					var fem = Q.firstErrorMessage(err);
					if (fem) {
						return console.warn("Travel/trip/preview: " + fem);
					}

					Q.handle(callback, this);
				});
			}
		}
	);

	Q.Template.set('Travel/trip/preview',
		'<div class="Travel_trip_preview_title">'
		+ '<div class="Travel_trip_preview_titleContent">{{{title}}}</div>'
		+ '<div class="Travel_trip_preview_status basic32 {{{status}}}"></div>'
		+ '<div class="Travel_trip_preview_time">'
		+   '<span>{{label}}</span>'
		+   '{{{tool "Q/timestamp" capitalized=true}}}'
		+ '</div>'
		+ '</div>'
		+ '{{{participantsTool}}}'
	);

})(Q, Q.jQuery, window);