(function (Q, $, window, undefined) {
	var Streams = Q.Streams;
	var Travel = Q.Travel;
	var Places = Q.Places;

	/**
	 * Travel/participants tool.
	 * Renders a tool with related trips list
	 * @method Travel/participants
	 * @param {Object} [options] this is an object that contains parameters for this function
	 *   @param {String} options.publisherId The publisher id of category stream
	 *   @param {String} options.streamName The name of the category stream
	 */
	Q.Tool.define("Travel/participants", function _Travel_trip_related(options) {
			var tool = this;
			var state = this.state;

			//Q.addStylesheet('{{Travel}}/css/travelParticipants.css', {slotName: 'Travel'});

			// on user state changed event
			Travel.Trip.onUserState.set(function (message) {
				var instructions = JSON.parse(message.instructions);
				var userState = instructions.state;
				var timestamp = instructions.timestamp;
				var userId = message.byUserId;

				// skip driver because driver always have one state - "driver"
				if(userId === state.publisherId){
					return;
				}

				tool.setUserState(userId, userState, timestamp);
			});

			// on coordinates changed event
			Travel.Trip.onCoordinates(
				state.publisherId, state.streamName
			).set(function (changed) {
				tool.setRouteIndex();
			}, tool);

			// on route changed event
			// need to set valid index of waiting passengers
			Travel.Trip.onRoute.set(function (fields) {
				tool.setRouteIndex();
			}, tool);

			// update trip stream and use updated
			tool.getStream(function(){
				tool.refresh(this);
			});
		},

		{
			publisherId: null,
			streamName: null
		},

		{
			refresh: function (stream) {
				var tool = this;
				var $te = $(this.element);
				var state = this.state;
				var peopleMax = stream.getAttribute("peopleMax");

				// create Streams/participants tool
				$te.tool('Streams/participants', {
					publisherId: state.publisherId,
					streamName: state.streamName,
					max: peopleMax,
					maxShow: peopleMax,
					showSummary: false,
					showControls: true,
					showBlanks: true,
					invite: {
						clickable: true
					},
					avatar: {
						icon: 40
					},
					onRefresh: function () {
						var participantsTool = this;
						var avatars = participantsTool.children("Users/avatar");
						
						Q.each(avatars, function(index, avatarTool){
							var userId = avatarTool.state.userId;

							// if avatar tool is empty - exit
							if(Q.isEmpty(userId)){
								return;
							}

							// if avatar for driver - just one state "driver"
							if(userId === state.publisherId){
								tool.setUserState(userId, "driver");
								return;
							}

							stream.getUserState(userId, function(userState, timestramp){
								tool.setUserState(userId, userState, timestramp);
							});
						});

						tool.setRouteIndex();
					}
				}, tool.prefix).activate();
			},
			/**
			 * Set route index to appropriate avatar tool
			 * route index - index of leg from route where user currently exist
			 * @method setRouteIndex
			 */
			setRouteIndex: function(){
				var tool = this;

				// update stream and use updated
				tool.getStream(function(){
					var tripStream = this;
					var allCoordinates = tripStream.getAllCoordinates();
					var polyline = Places.polyline(tripStream.getRoute());
					if(!polyline){
						console.warn("Travel/participants tool: route absent");
					}

					Q.each(allCoordinates, function(userId, coords){
						var closest = Places.closest({
							x: coords.latitude,
							y: coords.longitude
						}, polyline);

						// user doesn't found on polyline
						if(Q.isEmpty(closest)){
							return;
						}

						// get avatar element, sent routeIndex attr and resort
						tool.getAvatar(userId, function(){
							this.attr({"data-routeIndex": closest.index});
							tool.sortAvatars();
						});
					});
				});
			},
			/**
			 * Set user state to appropriate avatar tool
			 * @method setUserState
			 * @param {string} [userId] User id
			 * @param {string} [state] New user state
			 * @param {number} [timestramp] time when state was changed (Unix timestamp)
			 */
			setUserState: function(userId, state, timestramp){
				var tool = this;

				// set userState attribute for each new users avatar
				tool.getAvatar(userId, function(){
					this.attr({"data-state": state, "data-timestamp": timestramp});
					tool.sortAvatars();
				});
			},
			/**
			 * Find avatar element for particular user
			 * @method getAvatar
			 * @param {string} [userId] User id
			 * @param {function} [callback] Callback need to execute when avatar tool found
			 */
			getAvatar: function(userId, callback){
				var tool = this;
				var i = 0;
				var limit = 10;

				// we need to wait for avatar appear because for new users
				// message can before avatar appear in participants tool
				var userAvatarTimerId = setInterval(function () {
					var $userAvatar = $(".Users_avatar_tool[id *= '" + userId + "']", tool.element);
					if (!$userAvatar.length){
						// if element doesn't found during timeout
						if(++i >= limit){
							clearInterval(userAvatarTimerId);
						}

						return;
					}

					clearInterval(userAvatarTimerId);

					// execute callback with avatar as context
					Q.handle(callback, $userAvatar);
				}, 500);
			},
			/**
			 * Sort avatars according to avatar state inside Streams/participants tool.
			 * @method sortAvatars
			 */
			sortAvatars: function(){
				// parent box for avatars elements with attribute data-state
				var $parentBox = $(".Q_tool.Users_avatar_tool[data-state]", this.element).parent();

				if(Q.isEmpty($parentBox.length)){
					return;
				}

				// put driver first
				$parentBox.append($(".Q_tool.Users_avatar_tool[data-state=driver]", $parentBox));

				// put riding second
				var ridinAvatars = $(".Q_tool.Users_avatar_tool[data-state=riding]", $parentBox);
				ridinAvatars.sort(function(a, b) {
					return parseInt($(a).attr("data-timestamp")) > parseInt($(b).attr("data-timestamp"));
				});
				Q.each(ridinAvatars, function(){
					$parentBox.append(this);
				});

				// put waiting third
				var waitingAvatars = $(".Q_tool.Users_avatar_tool[data-state=waiting]", $parentBox);
				waitingAvatars.sort(function(a, b) {
					return parseInt($(a).attr("data-routeIndex")) > parseInt($(b).attr("data-routeIndex"));
				});
				Q.each(waitingAvatars, function(){
					$parentBox.append(this);
				});
			},
			/**
			 * Get trip stream and launch callback with this stream as context
			 * @method getStream
			 * @param {Function} [callback] callback
			 */
			getStream: function(callback){
				var state = this.state;

				Q.Streams.get(state.publisherId, state.streamName, function (err) {
					var fem = Q.firstErrorMessage(err);
					if (fem) {
						return console.warn("Travel/participants: " + fem);
					}

					Q.handle(callback, this);
				});
			}
		}
	);
})(Q, Q.jQuery, window);