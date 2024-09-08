<?php
/**
 * @module Travel
 */
/**
 * Class representing 'Trip' rows in the 'Travel' database
 * You can create an object of this class either to
 * access its non-static methods, or to actually
 * represent a stream row in the Travel database.
 *
 * @class Travel_Trip
 * @extends Base_Travel_Trip
 */
class Travel_Trip extends Base_Travel_Trip
{
	/**
	 * Possible state transitions for trip participants.
	 * The keys are state names, and values are arrays of state names
	 * to which the user can transition.
	 * @property $STATES
	 * @type array
	 */
	/**
	 * Simply observing the trip. This is the default.
	 * @property $STATES['observing']
	 * @type array
	 * @final
	 */
	/**
	 * Planning a drive a vehicle, didn't start driving yet
	 * @property $STATES['planning']
	 * @type array
	 * @final
	 */
	/**
	 * Driving along a route in the trip.
	 * @property $STATES['driving']
	 * @type array
	 * @final
	 */
	/**
	 * Passenger waiting to get picked up.
	 * @property $STATES['waiting']
	 * @type array
	 * @final
	 */
	/**
	 * The passenger has canceled waiting before they were picked up.
	 * @property $STATES['canceled']
	 * @type array
	 * @final
	 */
	/**
	 * The passenger has been picked up and is riding in the vehicle.
	 * @property $STATES['riding']
	 * @type array
	 * @final
	 */
	/**
	 * The passenger has been expelled from the vehicle.
	 * @property $STATES['expelled']
	 * @type array
	 * @final
	 */
	/**
	 * The passenger has arrived at their destination.
	 * @property $STATES['arrived']
	 * @type array
	 * @final
	 */
	/**
	 * The driver has completed their trip.
	 * @property $STATES['completed']
	 * @type array
	 * @final
	 */
	/**
	 * The driver has discontinued their trip.
	 * @property $STATES['discontinued']
	 * @type array
	 * @final
	 */
	/**
	 * The driver has stopped during their trip
	 * @property $STATES['stopped']
	 * @type array
	 * @final
	 */
	public static $STATES = array(
		'observing' => array('waiting'), // initial state for passengers
		'waiting' => array('riding', 'canceled'),
		'riding' => array('expelled', 'arrived'),
		'planning' => array('driving', 'discontinued'), // initial state for drivers
		'driving' => array('completed', 'stopped', 'discontinued'),
		'stopped' => array('driving', 'discontinued')
	);

	/**
	 * The possible trip states
	 * @property $TRIP_STATES
	 * @type array
	 * @final
	 */
	private static $TRIP_STATES = array('new', 'started', 'cancelled', 'discontinued', 'completed');

	/**
	 * @method getAllCoordinates
	 * @param {Streams_Stream} The Travel/trip stream
	 * @return {array} The array of all coordinates set in the trip
	 */
	static function getAllCoordinates($stream)
	{
		return empty($stream->coordinates) 
			? array()
			: json_decode($stream->coordinates, true);
	}
	
	/**
	 * @method getCoordinates
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string|array} $userId The id of a participant in the trip
	 * @return {array|null} The coordinates of the user set in the trip
	 */
	static function getCoordinates($stream, $userId)
	{
		$c = self::getAllCoordinates($stream);
		return Q::ifset($c, $userId, null);
	}
	
	/**
	 * @method setCoordinates
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string|array} $userId The id of a user,
	 *  or an array of $userId => $value pairs
	 * @param {array} $coordinates The coordinates of the driver or the passenger pickup point.
	 * If it null - remove these coordinates from trip.
	 * @param {double} $coordinates.latitude
	 * @param {double} $coordinates.longitude
	 * @param {double} $coordinates.heading
	 * @return {boolean} whether any action was taken
	 */
	static function setCoordinates($stream, $userId, $coordinates = null)
	{
		$c = self::getAllCoordinates($stream);
		if (is_array($userId)) {
			foreach ($userId as $k => $v) {
				if(empty($coordinates)){
					unset($c[$k]);
					continue;
				}
				Q_Valid::requireFields(array('latitude', 'longitude'), $v, true);
				$c[$k] = $v;
			}
		} else {
			if(empty($coordinates)){
				unset($c[$userId]);
			}else{
				Q_Valid::requireFields(array('latitude', 'longitude'), $coordinates, true);
				$c[$userId] = $coordinates;
			}
		}
		foreach ($c as $k => &$v) {
			foreach (array('latitude', 'longitude', 'heading') as $f) {
				if (isset($v[$f])) {
					$v[$f] = floatval($v[$f]);
				}
			}
		}
		$stream->coordinates = Q::json_encode($c);
		$stream->changed();

		// if coordinates empty - means some user leave the trip
		if(empty($coordinates)){
			// just recalculate route without this user
			self::route($stream);

			// and save stream
			$stream->changed();

			return;
		}

		$latitude = $coordinates['latitude'];
		$longitude = $coordinates['longitude'];

		$distances = Q_Config::expect("Travel", "Trip", "distances");
		foreach ($distances as $k => $v) {
			$distances[$k] = (int)$v;
		}

		// find closest waiting passenger
		$publisherId = $stream->publisherId;
		$streamName = $stream->name;
		$tripState = $stream->getAttribute("state");
		$state = 'participating';
		$participants = Streams_Participant::select()
			->where(@compact('publisherId', 'streamName', 'state'))
			->fetchDbRows();
		$min_distance = null;
		$closestPassenger = null;
		$driverLocation = self::getCoordinates($stream, $publisherId);
		foreach ($participants as $p) {
			$state = $p->getExtra('state');

			if ($state !== 'waiting') {
				continue;
			}
			// are we arriving?
			if ($userLocation = self::getCoordinates($stream, $p->userId)) {
				// get distance between driver and passenger
				$distance = Places::distance(
					$driverLocation['latitude'], $driverLocation['longitude'],
					$userLocation['latitude'], $userLocation['longitude']
				);
				if (!isset($min_distance) or $distance < $min_distance) {
					$closestPassenger = $p;
					$min_distance = $distance;
				}
			}
		}

		// driver close to some passenger
		if ($closestPassenger && $tripState === "started") {
			$closestPassengerId = $closestPassenger->userId;
			$closestPassengerName = Streams_Stream::fetch($closestPassengerId, $closestPassengerId, "Streams/user/firstName")->content;
			if (!$closestPassenger->getExtra('gotArrivingNote') && isset($distances['arriving']) && $min_distance < $distances['arriving']) {
				// post a message that we are arriving to pick up a passenger
				$stream->post($publisherId, array(
					'type' => 'Travel/trip/arriving',
					'instructions' => array(
						'driverId' => $publisherId,
						'passengerId' => $closestPassengerId,
						"passengerName" => $closestPassengerName
					)
				), true);

				// mark passenger got this notification to avoid multiple notifications
				$closestPassenger->setExtra('gotArrivingNote', true);
				$closestPassenger->save();
			}

			if (isset($distances['pickup'])
			and $min_distance < $distances['pickup']) {
				self::setState($stream, $closestPassengerId, 'riding');
			}
		}

		// driver close to finish point of trip
		if ($userId === $publisherId && $tripState === "started" && isset($distances['arriving'])) {
			$tripFinish = $stream->getAttribute("to");
			$distanceFinish = Places::distance(
				$driverLocation['latitude'],
				$driverLocation['longitude'],
				$tripFinish['latitude'],
				$tripFinish['longitude']
			);

			if($distances['arriving'] >= $distanceFinish){
				// post a message that we are arriving to finish
				$stream->post($publisherId, array(
					'type' => 'Travel/trip/finishing',
					'instructions' => array(
						'driverId' => $publisherId
					)
				), true);
			}
		}

		// see if we need to recalculate the route
		$directions = $stream->directions;
		if (!$directions) {
			return;
		}
		$directions = Q::json_decode($directions, true);
		$route = reset($directions['routes']);
		$polyline = Places::polyline($route);
		$point = array(
			'x' => $latitude,
			'y' => $longitude
		);
		$closest = Places::closest($point, $polyline);
		$distance = Places::distance($latitude, $longitude, $closest['x'], $closest['y']);
		if ($distance > $distances['route']) {
			if($tripState === "started"){
				// if route changed, set start point to current driver position
				$stream->setAttribute("from", json_decode(json_encode($driverLocation), FALSE));
				$stream->save();
			}

			self::route($stream);

			/*Q::log(print_r(array(
				'UserLat' => $latitude,
				'UserLng' => $longitude,
				'RouteLat' => $closest['x'],
				'RouteLng' => $closest['y'],
				'distance' => $distance,
				'route' => $distances['route']
			), true), "travel");*/
		}
	}
	
	/**
	 * @method clearCoordinates
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $userId The name of the cordinates to remove
	 */
	static function clearCoordinates($stream, $userId)
	{
		$coordinates = self::getAllCoordinates($stream);
		unset($coordinates[$userId]);
		$stream->coordinates = Q::json_encode($coordinates);
	}
	
	/**
	 * Get participant of travel trip by user id
	 * @method participant
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $userId
	 */
	static function participant($stream, $userId) {
		$participant = null;
		if ($stream->get('asUserId') === $userId) {
			$participant = $stream->get('participant');
		}
		if (!$participant) {
			$participant = new Streams_Participant();
			$participant->publisherId = $stream->publisherId;
			$participant->streamName = $stream->name;
			$participant->userId = $userId;
			if (!$participant->retrieve()) {
				// this shouldn't happen, but just in case
				throw new Q_Exception_MissingRow(array(
					'table' => 'participant',
					'criteria' => http_build_query($participant->toArray(), '', ' & ')
				));
			}
		}
		return $participant;
	}
	/**
	 * Get all Places/nearby streams closer than config Travel/Trip/distances/subscribe meters
	 * and post message "Travel/trip/added".
	 * @method sendNotifications
	 * @param {object} $tripStream Trip stream
	 */
	static function sendNotifications($tripStream){
		$location = $tripStream->getAttribute("type") === "Travel/from" ? $tripStream->getAttribute("from") : $tripStream->getAttribute("to");
		$distance = Q_Config::expect('Travel', 'Trip', 'distances', 'subscribe');
		$results = Places_Nearby::forSubscribers($location["latitude"], $location["longitude"], $distance);
		$communityId = Users::communityId();

		foreach($results as $streamName => $data){
			$stream = Streams_Stream::fetch($communityId, $communityId, $streamName);

			if(empty($stream)){
				continue;
			}

			// create notification link from app event
			$notificationData = Q::event('Travel/trip/added', @compact(
				'tripStream'
			));

			$stream->post($communityId, array(
				'type' => 'Travel/trip/added',
				'instructions' => array(
					"venue" => $tripStream->getAttribute("venue"),
					"link" => Q::ifset($notificationData, "link", null),
					"icon" => Q_Request::baseUrl()."/Q/plugins/Travel/img/alert-icon.png"
				)
			), true);
		}
	}
	/**
	 * Create a Travel/trip stream and do related actions
	 * @method create
	 * @param {string} $asUserId Pass a user id, or null to use current logged-in user
	 * @param {array} $fields Initial fields to assign to the stream.
	 * @param {string} $fields.publisherId The publisher of the stream.
	 * @param {array} $fields.attributes Attributes to assign to the stream
	 * @param {array} $fields.attributes.from where the trip is departing from
	 * @param {double} $fields.attributes.from.latitude
	 * @param {double} $fields.attributes.from.longitude
	 * @param {timestamp} $fields.attributes.from.timestamp
	 * @param {array} $fields.attributes.to where the trip is arriving to
	 * @param {double} $fields.attributes.to.latitude
	 * @param {double} $fields.attributes.to.longitude
	 * @param {timestamp} $fields.attributes.from.timestamp
	 * @param {array} [$fields.relate=null] any additional stream to relate this trip to
	 * @param {double} [$fields.relate.publisherId]
	 * @param {double} [$fields.relate.streamName]
	 * @return {array} Array with "stream" and "participant" objects
	 */
	static function create($asUserId, $fields, $relate = null)
	{
		// validate asUserId
		if (!isset($asUserId)) {
			$asUserId = Users::loggedInUser(true)->id;
		}

		// default trip state for just created trip
		$fields["attributes"]["state"] = "new";

		// validate labels
		$labels = null;
		if (!empty($fields["attributes"]["labels"])) {
			if (is_string($fields["attributes"]["labels"])) {
				$labels = explode("\t", $fields["attributes"]["labels"]);
			}
			$rows = Users_Label::fetch($asUserId, $labels, array(
				'checkContacts' => true
			));
			foreach ($labels as $label) {
				if (!isset($rows[$label])) {
					throw new Exception("No contacts found with label $label");
				}
			}
		}

		// create trip stream (and relate it to the category, if any)
		$startTime = Q::ifset($fields, 'attributes', 'startTime', null);
		$endTime = Q::ifset($fields, 'attributes', 'endTime', null);
		$from = Q::ifset($fields, 'attributes', 'from', null);
		$to = Q::ifset($fields, 'attributes', 'to', null);
		foreach (array('from', 'to') as $field) {
			if ($field === null) {
				throw new Q_Exception_RequiredField(array('field' => "fields.attributes.$field"));
			}
		}
		$type = Q::ifset($fields, 'attributes', 'type', null);
		if ($type === 'Travel/to') {
			if (!$endTime) {
				throw new Q_Exception_RequiredField(array(
					'field' => 'fields.attributes.endTime'
				));
			}
		} else if ($type === 'Travel/from') {
			if (!$startTime) {
				throw new Q_Exception_RequiredField(array(
					'field' => 'fields.attributes.startTime'
				));
			}
		} else {
			throw new Q_Exception_WrongValue(array(
				'field' => 'type',
				'range' => "Travel/to or Travel/from"
			));
		}
		$fields['coordinates'] = '';
		$stream = Streams::create($asUserId, $asUserId, "Travel/trip", $fields);

		// relate trip stream if relation info exist
		self::relateTo($stream, $relate);

		$result = self::route($stream);
		if (isset($result['routes'])) {
			$route = reset($result['routes']);
			$leg = reset($route['legs']);
			$from['latitude'] = floatval($leg['start_location']['lat']);
			$from['longitude'] = floatval($leg['start_location']['lng']);
			$route = end($result['routes']);
			$leg = end($route['legs']);
			$to['latitude'] = floatval($leg['end_location']['lat']);
			$to['longitude'] = floatval($leg['end_location']['lng']);
		}
		$stream->setAttribute(@compact('from', 'to'));
		$stream->changed();

		// save any access rows for labels
		if (!empty($labels)) {
			foreach ($labels as $label) {
				$access = new Streams_Access();
				$access->publisherId = $stream->publisherId;
				$access->streamName = $stream->name;
				$access->ofContactLabel = $label;
				$access->readLevel = Streams::$READ_LEVEL['max'];
				$access->writeLevel = Streams::$WRITE_LEVEL['relate'];
				$access->adminLevel = Streams::$ADMIN_LEVEL['invite'];
				$access->save();
			}
		}

		// set some variables
		$communityId = Users::communityId();

		// relate stream to Places_Nearby "Travel/from" trip origin
		$streamNames = array();
		Places_Nearby::streams(
			$communityId,
			$from["latitude"],
			$from["longitude"],
			array('skipAccess' => true),
			$streamNames
		);
		Streams::relate(
			$asUserId,
			$communityId,
			$streamNames,
			'Travel/from',
			$stream->publisherId,
			$stream->name,
			array(
				"weight" => $startTime,
				"skipAccess" => true
			)
		);
		
		// relate to Places_Nearby "Travel/to" trip destination
		$streamNames = array();
		Places_Nearby::streams(
			$communityId,
			$to["latitude"],
			$to["longitude"],
			array('skipAccess' => true),
			$streamNames
		);
		Streams::relate(
			$asUserId,
			$communityId,
			$streamNames,
			'Travel/to',
			$stream->publisherId,
			$stream->name,
			array(
				"weight" => $endTime,
				"skipAccess" => true
			)
		);

		$state = 'planning';
		$timestamp = time();
		$extra = @compact('state', 'startTime', 'endTime', 'timestamp');
		$participant = $stream->subscribe(@compact('extra'));

		// send notifications to peoples looking this location
		self::sendNotifications($stream);

		$recurringCategory = Calendars_Recurring::makeRecurring($stream, $fields['recurringInfo']);
		// subscribe driver to recurring category
		if ($recurringCategory instanceof Streams_Stream) {
			$extra = array(
				"period" => $fields['recurringInfo']['period'],
				"days" => $fields['recurringInfo']['days']
			);

			$recurringCategory->join(@compact('extra'));

			$eventRecurringCategory = Calendars_Recurring::fromStream($relate);

			// relate trip recurring categories to event recurring category
			if ($eventRecurringCategory instanceof Streams_Stream) {
				$recurringCategory->relateTo($eventRecurringCategory, "Travel/trip", $recurringCategory->publisherId);
				$recurringCategory->setAttribute("parentRecurring", $eventRecurringCategory->getAllAttributes());
				$recurringCategory->save();
			}
		}

		return @compact('stream', 'participant');
	}
	/**
	 * If category stream provided - relate trip stream to this category
	 * @method relateTo
	 * @static
	 * @param {Streams_Stream} $tripStream The Travel/trip stream
	 * @param {Streams_Stream|array} $relate stream or array with category stream info array(publisherId => ..., streamName => ...)
	 */
	static function relateTo ($tripStream, $relate) {
		if (!$tripStream instanceof Streams_Stream) {
			return false;
		}

		if (!$relate instanceof Streams_Stream && !is_array($relate)) {
			return false;
		}

		if(is_array($relate)) {
			if (empty($relate['publisherId']) || empty($relate['streamName'])) {
				throw new Exception("Travel_Trip::relateTo: relate wrong!");
			}

			// get stream
			$relate = Streams_Stream::fetch(null, $relate['publisherId'], $relate['streamName']) ;
		}

		$type = $tripStream->getAttribute("type");
		$weight = 0;

		// calculate weight
		if ($type == 'Travel/to') {
			$weight = $tripStream->getAttribute("endTime");
		} else if ($type == 'Travel/from') {
			$weight = $tripStream->getAttribute("startTime");
		}

		if (!$weight) {
			throw new Exception("Travel_Trip::relateTo: weight empty!");
		}

		$tripStream->relateTo($relate, $type, $tripStream->publisherId, @compact('weight', 'type'));
	}
	/**
	 * Start the trip, as a driver
	 * @method start
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $driverId should be a driver user id
	 * @param {array} [$coordinates=null] can be used to set initial coordinates of driver
	 * @param {double} [$coordinates.latitude]
	 * @param {double} [$coordinates.longitude]
	 * @param {double} [$coordinates.heading] optional
	 */
	static function start($stream, $driverId, $coordinates = null)
	{
		if (!isset($driverId)) {
			$driverId = Users::loggedInUser(true)->id;
		}
		if ($driverId != $stream->publisherId) {
			throw new Q_Exception("You can't do this, because you not a driver!");
		}
		$participant = self::participant($stream, $driverId);
		$state = $participant->getExtra('state');
		if ($state !== 'planning') {
			throw new Travel_Exception_StateTransition(array(
				'state' => 'driving',
				'currentState' => $state
			));
		}

		if (!isset($coordinates)) {
			$coordinates = $stream->getAttribute('from');
		}
		self::setState($stream, $driverId, 'driving');
		self::setCoordinates($stream, $driverId, $coordinates);
		$timestamp = time();
		$stream->setAttribute("from", $coordinates);
		$stream->setAttribute("state", 'started');
		$stream->setAttribute("startTime", $timestamp);
		$stream->save(); // need to save before run "route" method, because it looking for "state" attribute
		self::route($stream); // update route & time estimates with more current traffic data
		$stream->changed();
		$stream->post($driverId, array(
			'type' => 'Travel/trip/started',
			'instructions' => @compact('timestamp')
		), true);
	}
	
	/**
	 * Discontinue the trip, as a driver
	 * @method discontinue
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $driverId should be a driver user id
	 */
	static function discontinue($stream, $driverId = null)
	{
		if (!isset($driverId)) {
			$driverId = Users::loggedInUser(true)->id;
		}
		if ($driverId != $stream->publisherId) {
			throw new Exception("You can't do this, because you not a driver!");
		}
		$reason = "discontinued";
		$stream->setAttribute(array("state" => "ended", "reason" => $reason));
		$stream->changed();

		// set participants extra
		Streams_Participant::update()->set(array(
			'extra' => Q::json_encode(array('state' => $reason, 'timestamp' => time()))
		))->where(array(
			'streamName' => $stream->name,
			'state' => "participating"
		))->execute();

		// if recurring category exist - close one
		$recurringCategory = Calendars_Recurring::fromStream($stream);
		if ($recurringCategory) {
			$recurringCategory->close($recurringCategory->publisherId);
		}

		$stream->close($driverId);
	}
	
	/**
	 * Indicate that the trip has been completed
	 * @method arrived
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $driverId should be a driver user id
	 */
	static function completed($stream, $driverId = null)
	{
		if (!isset($driverId)) {
			$driverId = Users::loggedInUser(true)->id;
		}
		if ($driverId != $stream->publisherId) {
			throw new Exception("You can't do this, because you not a driver!");
		}
		$stream->setAttribute(array("state" => "ended", "reason" => "arrived"));
		$stream->changed();

		// set participants extra
		Streams_Participant::update()->set(array(
			'extra' => Q::json_encode(array('state' => 'arrived', 'timestamp' => time()))
		))->where(array(
			'streamName' => $stream->name,
			'state' => "participating"
		))->execute();

		$stream->close($driverId);
	}
	
	/**
	 * Become a waiting passenger. Check trip peopleMax and detourMax conditions.
	 * @method join
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $passengerId should be passenger user id
	 * @param {array} $coordinates The coordinates of the pickup point
	 * @param {double} $coordinates.latitude
	 * @param {double} $coordinates.longitude
	 * @return {boolean} whether any action was taken
	 */
	static function join($stream, $passengerId, $coordinates = array())
	{
		if ($passengerId == $stream->publisherId) {
			// this action is only for passengers
			return false;
		}
		if ($stream->getAttribute("state") == "started") {
			// for now, passengers can't join a strip that has already started
			throw new Travel_Exception_TripAlreadyStarted();
		}

		// check if we would exceed max number of people
		$peopleMax = $stream->getAttribute('peopleMax', 0);
		$publisherId = $stream->publisherId;
		$streamName = $stream->name;
		$state = 'participating';
		$participants = Streams_Participant::select()
			->where(@compact('publisherId', 'streamName', 'state'))
			->fetchDbRows();
		$already = false;
		$waypoints = array();
		foreach ($participants as $p) {
			$s = $p->getExtra('state');
			if (!in_array($s, array('waiting', 'riding', 'planning', 'driving'))) {
				continue;
			}

			// skip driver
			if($p->userId === $publisherId){
				continue;
			}

			// passenger already joined
			if ($p->userId === $passengerId) {
				$already = true;
				break;
			}

			$waypoints[] = array("userId" => $p->userId, "location" => self::getCoordinates($stream, $p->userId));
		}
		if ($already) {
			return false;
		}
		
		if ($peopleMax and count($waypoints) >= $peopleMax) {
			throw new Streams_Exception_Full(array('type' => 'trip'));
		}

		// now check if we would exceed trip's detour max
		$startTime = (int)$stream->getAttribute('startTime');
		$endTime = (int)$stream->getAttribute('endTime');
		$detourMax = (float)$stream->getAttribute('detourMax', 0);
		$detourType = $stream->getAttribute('detourType');
		if ($detourMax and $detourType and $startTime and $endTime) {
			$duration = $endTime - $startTime;
			$distance = (int)$coordinates["distance"];
			$waypoints[] = array("userId" => $passengerId, "location" => $coordinates);
			$newRoute = self::route($stream, $waypoints);
			$seconds = 0;
			$meters = 0;
			if (empty($newRoute['routes'][0]['legs'])) {
				$message = "Route seems to be empty";
				throw new Travel_Exception_Routing(@compact('message'));
			}
			foreach ($newRoute["routes"][0]["legs"] as $leg){
				$seconds += (int)$leg["duration"]["value"];
				$meters += (int)$leg["distance"]["value"];
			}
			switch ($detourType) {
				case "minutes":
					if ($seconds > $duration + ($detourMax * 60)) {
						throw new Travel_Exception_TripDuration();
					}
					break;
				case "kilometers":
					if ($meters > $distance + ($detourMax * 1000)) {
						throw new Travel_Exception_TripDuration();
					}
					break;
				case "miles":
					if ($meters > $distance + ($detourMax * 1609.344)) {
						throw new Travel_Exception_TripDuration();
					}
					break;
			}
		}
		if ($coordinates) {
			self::setCoordinates($stream, $passengerId, $coordinates);
		}
		$stream->changed();
		$options = array('filter' => array(
			"types" => array(
				"^Travel/trip/.*",
				"Streams/relatedTo",
				"Streams/chat/message",
			),
			"notifications" => 0
		));
		$stream->subscribe($options); // now the passenger will receive notifications
		$state = 'waiting';
		$extra = @compact('state', 'startTime', 'endTime', 'coordinates');
		self::setState($stream, $passengerId, $state, $extra);

		self::route($stream);
		$stream->changed();

		return true;
	}
	
	/**
	 * Leave the trip and stop getting notifications about it
	 * @method leave
	 * @static
	 * @param {Streams_Stream} The Travel/trip stream
	 * @param {string} $passengerId should be passenger user id
	 */
	static function leave($stream, $passengerId)
	{
		if ($passengerId == $stream->publisherId) {
			// this action is only for passengers
			throw new Users_Exception_NotAuthorized();
		}
		$participant = self::participant($stream, $passengerId);
		$stream = Streams_Stream::fetch($passengerId, $stream->publisherId, $stream->name, true, array(
			'withParticipant' => true
		));
		if ($participant) {
			$state = $participant->getExtra('state');
			$transitions = array(
				'riding' => 'expelled',
				'waiting' => 'canceled'
			);
			if (isset($transitions[$state])) {
				$newState = $transitions[$state];
				self::setState($stream, $passengerId, $newState);
			}
		}
		$stream->leave(); // leave the stream, won't get any more notifications

		// remove passenger coordinates from trip
		self::setCoordinates($stream, $passengerId, null);
	}

	/**
	 * Get all the Travel/trip streams the user is participating in,
	 * as related to their "Travel/particpiating/trips" category stream.
	 * @method participating
	 * @static
	 * @param {string} [$userId=Users::loggedInUser()] The user who is participating
	 * @param {integer} [$fromTime=null] The earliest endTime timestamp of the stream
	 * @param {integer} [$untilTime=null] The latest startTime timestamp of the stream
	 * @param {array|string} [$state] States to filter by, can be a comma-delimited string
	 * @param {array} [$options] Any additional options
	 * @param {callable} [$options.filter] Function to call to filter the relations.
	 * @return {array} The streams, filtered by the above parameters
	 */
	static function participating(
		$userId, 
		$fromTime,
		$untilTime,
		$state = null,
		$options = array()
	) {
		if (!isset($userId)) {
			$userId = Users::loggedInUser(true)->id;
		}
		if (is_string($state)) {
			$state = explode(',', $state);
		}
		$options = array_merge($options, array(
			'fetchOptions' => array(
				"orderBy" => "updatedTime",
				"refetch" => true,
				"dontCache" => true
			),
			'filter' => function ($relations) use ($state, $fromTime, $untilTime) {
				$result = array();
				foreach ($relations as $r) {
					$startTime = $r->getExtra('startTime');
					$endTime = $r->getExtra('endTime');
					if (($fromTime and $endTime < $fromTime)
					or ($untilTime and $startTime > $untilTime)
					or (isset($state)
						and !in_array($r->getExtra('state', 'observing'), $state))
					) {
						continue;
					}
					$result[] = $r;
				}
				return $result;
			}
		));
		$options['asUserId'] = $userId;
		return Streams::participating("Travel/trip", $options);
	}
	
	/**
	 * Sets the user's state in the trip, and posts a Travel/user/state message.
	 * You might want to make the passenger leave the strem if this method succeeds.
	 * @method setState
	 * @static
	 * @param {string} [$userId] stream participant
	 * @param {string} [$publisherId] trip stream publisher
	 * @param {string} [$streamName] trip stream name
	 * @param {string} [$state] new participant state
	 * @param {array} [$extra=array()] Any other extra parameters to set or override,
	 *   if this new state is allowed.
	 * @return {boolean} whether anything was done
	 * @throws {Travel_Exception_StateTransition} if the state transition is not allowed
	 */
	static function setState($stream, $userId, $state, $extra = array())
	{
		$user = Users_User::fetch($userId, true);
		
		$participant = self::participant($stream, $userId);
		$currentState = $participant->getExtra('state');
		if ($currentState == $state) {
			// state didn't change - do nothing
			return false;
		}
		if (isset(self::$STATES[$currentState])
		and !in_array($state, self::$STATES[$currentState])) {
			$possibleStates = implode(',', self::$STATES[$currentState]);
			throw new Travel_Exception_StateTransition(
				@compact('currentState', 'state', 'possibleStates')
			);
		}

		$timestamp = time();
		$extra = array_merge($extra, @compact('state', 'timestamp'));
		$participant->setExtra($extra);
		$participant->save();

		if ($state === 'riding') {
			// user was just picked up
			$stream->setAttribute('lastPickup', $userId);

			// recalculate route after each passeneger picked up
			$driverLocation = self::getCoordinates($stream, $stream->publisherId);
			$stream->setAttribute("from", json_decode(json_encode($driverLocation), FALSE));
			$stream->save();
			self::route($stream);
			$stream->changed();

			// send message about passenger picked up
			$stream->post($userId, array(
				'type' => 'Travel/trip/pickup',
				'instructions' => array(
					'driverId' => $stream->publisherId,
					'passengerId' => $userId,
					"passengerName" => $user->displayName(array('short' => true))
				)
			), true);
		}

		// change recurring participation if trip is recurring
		// only if user waiting or cancelled
		if ($state == "canceled" || $state == "waiting") {
			$recurringState = $state == "waiting" ? true : false;

			// add or remove current day from participant row
			self::changeUserParticipation($stream, $userId, $recurringState, $extra);
		}

		Streams_Message::post($userId, $stream->publisherId, $stream->name, array(
			'type' => 'Travel/trip/user/state',
			'instructions' => $extra
		), true);
	}
	/**
	 * Get (or create) user participation to recurring stream and change days extra
	 * @method changeUserParticipation
	 * @param {Streams_Stream} $stream Required.
	 * @param {string} $userId Required.
	 * @param {bool} $state Required. Whether user participated or not.
	 * @param {array} $extra Optional. Additional extra params to save to extras
	 * @throws
	 */
	static function changeUserParticipation ($stream, $userId, $state, $extra = array()) {
		$recurringCategory = Calendars_Recurring::fromStream($stream);
		// stream is not recurring
		if (!$recurringCategory) {
			return;
		}

		$period = $recurringCategory->getAttribute("period");
		$recurringDays = (array)$recurringCategory->getAttribute("days");

		// get participant row for current user.
		$participant = Calendars_Recurring::getRecurringParticipant($stream, $userId);

		$days = array();
		if ($participant->inserted) { // if participant just created - use days from event participant
			if ($eventStream = self::getEventByTrip($stream)) {
				if (Calendars_Recurring::fromStream($eventStream)) {
					if ($eventParticipant = Calendars_Recurring::getRecurringParticipant($eventStream, $userId)) {
						$days = $eventParticipant->getExtra("days", array());
					}
				}
			}
		} else { // if already created - use days from trip participant
			$days = $participant->getExtra("days", array());
		}

		$startDate = (int)$stream->getAttribute("startTime");

		$currentDay = date("D", $startDate);

		if ($period == "weekly") {
			$currentDay = date("D", $startDate); // Mon, Tue, ...
		} elseif($period == "monthly") {
			$currentDay = date("j", $startDate); // 1, 2, ... 31
		} else {
			throw new Exception("Calendars_Recurring::changeUserParticipation: period invalid!");
		}

		$key = array_search($currentDay, $days);

		// if user going and this day not exist
		if ($state && $key === false && in_array($currentDay, $recurringDays)) {
			$days[] = $currentDay;
		} elseif(!$state && $key !== false) { // if user not going and this day exist
			unset($days[$key]);
		}

		$participant->setExtra("days", $days);
		$participant->setExtra("period", $period);
		$participant->setExtra($extra);

		$participant->save();
	}
	/**
	 * Get waypoint as array and return string ready to use for google request
	 * @method parseGoogleLocation
	 * @param {Streams_Stream} $stream
	 * @param {array} $waypoint Can be one of the following:
	 * 	  array("userId" => [string]),
	 * 	  array("placeId" => [string]),
	 * 	  array("latitude" => [string], "longitude" => [string]),
	 * 	  array("address" => [string])
	 * @param {array} [$waypoint.stopover=true] Can be set to false if necessary.
	 * return {string}
	 */
	protected static function parseGoogleLocation($stream, $location)
	{
		if ($userId = Q::ifset($location, 'userId', null)) {
			$coordinates = self::getCoordinates($stream, $userId);
			return $coordinates['latitude'] . ',' . $coordinates['longitude'];
		}
		if (Q::ifset($location, 'placeId', null)){
			return 'place_id:' . $location['placeId'];
		}
		if (Q::ifset($location, 'latitude', null)
		&& Q::ifset($location, 'longitude', null)){
			return $location['latitude'] . ',' . $location['longitude'];
		}
		if (Q::ifset($location, 'address', null)){
			return $location['address'];
		}
		throw new Q_Exception_WrongValue(array(
			'field' => 'location',
			'range' => 'userId, placeId, latitude&longitude, or address'
		));
	}
	/**
	 * get Event stream where to trip related
	 * @method getEventByTrip
	 * @param {Streams_Stream} $trip Required. Trip stream or array("publisherId" => ..., "streamName" => ...)
	 * @return {boolean|object}
	 */
	static function getEventByTrip ($trip) {
		$relation = Streams_RelatedTo::select()->where(array(
			'fromPublisherId' => $trip->publisherId,
			'fromStreamName' => $trip->name,
			'type' => array("Travel/to", "Travel/from"),
			'toStreamName like ' => "Calendars/event/%"
		))->fetchDbRow();

		if(empty($relation)) {
			return false;
		}

		$event = Streams_Stream::fetch($relation->toPublisherId, $relation->toPublisherId, $relation->toStreamName);

		return $event;
	}
	/**
	 * Query google for a route, and return the info
	 * @method route
	 * @param {string} $publisherId Trip stream publisher (driver)
	 * @param {string} $streamName Trip stream name
	 * @param {array} [$waypoints] Optional. Array of additional waypoints to add to route.
	 *  Each waypoint can be one of the following arrays:
	 * 	  array("userId" => [string]),
	 * 	  array("placeId" => [string]),
	 * 	  array("latitude" => [string], "longitude" => [string]),
	 * 	  array("address" => [string])
	 *  Each waypoint can have optional ("stopover" => false).
	 * @param {array} $options
	 * @param {string} [$options.travelMode='driving'] can be "driving", "bicycling", "transit", "walking"
	 * @param {boolean} [$options.optimize=true] pass false here to keep waypoints in the given order
	 * @param {timestamp} [$options.startTime=null] Time to start trip. Standard Unix time (seconds from 1970). If set, do not set endTime.
	 * @param {timestamp} [$options.endTime=null] Time to end trip. Standard Unix time (seconds from 1970). If set, do not set startTime.
	 * @return {array}
	 */
	static function route($stream, $waypoints = array(), $options = array())
	{
		$key = Q_Config::expect('Places', 'google', 'keys', 'server');
		$attributes = $stream->getAllAttributes();
		$driverId = $stream->publisherId;
		Q_Valid::requireFields(array('from', 'to'), $attributes, true);
		$drivingMode = Q::ifset($options, 'travelMode', 'driving');
		$data = array();
		$data['origin'] = self::parseGoogleLocation($stream, $attributes['from']);
		$data['destination'] = self::parseGoogleLocation($stream, $attributes['to']);
		$data['travelMode'] = strtoupper($drivingMode);
		if ($startTime = Q::ifset(
			$options, 'startTime', $stream->getAttribute('startTime')
		)) {
			$params['departure_time'] = $startTime;
		}
		if ($endTime = Q::ifset(
			$options, 'endTime', $stream->getAttribute('endTime')
		)) {
			$params['arrival_time'] = $endTime;
		}

		$coordinates = self::getAllCoordinates($stream);

		// always driver to first position
		if($driverCoords = Q::ifset($coordinates, $driverId, false)){
			unset($coordinates[$driverId]);
			$coordinates = array_merge(array($driverId => $driverCoords), $coordinates);
		}

		// if waypoints empty collect them from trip stream
		if(empty($waypoints)){
			foreach($coordinates as $userId => $location) {
				// get user state from participants extra
				if ($userState = Streams_Participant::select()->where(array('streamName' => $stream->name, 'userId' => $userId))->fetchDbRow()){
					$userState = $userState->getExtra('state');

					// skip picked up passengers
					if($userState === "riding"){
						continue;
					}
				}

				$waypoints[] = array("userId" => $userId, "location" => $location, "stopover" => $userId === $driverId ? false : true);
			}
		}

		$data['waypoints'] = array();

		// set optimize param (true by default)
		$data['waypoints'][] = "optimize:".(Q::ifset($options, 'optimize', true) ? "true" : "false").'|';

		foreach ($waypoints as $waypoint){
			$via = (isset($waypoint['stopover']) and $waypoint['stopover'] === false);
			$prefix = $via ? 'via:' : '';
			$data['waypoints'][] = $prefix . self::parseGoogleLocation($stream, $waypoint['location']);
		}
		// convert waypoints to string
		$data['waypoints'] = implode('|', $data['waypoints']);
		$data['key'] = $key;
		$querystring = http_build_query($data);
		$url = "https://maps.googleapis.com/maps/api/directions/json?$querystring";

		$json = file_get_contents($url, false, stream_context_create(array(
			"ssl" => array(
				"verify_peer" => false,
				"verify_peer_name" => false,
			)
		)));

		$json = str_replace('"html_instructions" :', '"instructions" :', $json);
		$result = Q::json_decode($json, true);
		// save the route for the DirectionsRenderer
		unset($data['key']);
		$data['waypoints'] = $waypoints;

		// add request data to result so it can be set by client in DirectionsRenderer
		$result['request'] = $data;
		
		// build up pickups array naming the userIds in the same order
		// as the waypoints were optimized
		$pickups = array();
		$legs = Q::ifset($result, 'routes', 0, 'legs', array());
		if (!$legs) {
			throw new Travel_Exception_Routing(array(
				'explanation' => 'no routes found'
			));
		}
		foreach ($legs as $leg) {
			foreach ($leg['steps'] as $step) {
				$latitude = floatval(Q::ifset($step, 'end_location', 'lat', null));
				$longitude = floatval(Q::ifset($step, 'end_location', 'lng', null));
				foreach ($coordinates as $userId => $c) {
					if ($c['latitude'] == $latitude
					and $c['longitude'] == $longitude
					and $userId != $stream->publisherId
					and !in_array($userId, $pickups)) {
						$pickups[] = $userId;
						// no break because more than one passenger
						// may be at the same location
					}
				}
			}
		}
		$result['routes'][0]['pickups'] = $pickups;
		
		// update time estimates
		if ($legs) {
			$type = $stream->getAttribute('type');
			$diff = 0;
			foreach ($legs as $leg) {
				$diff += intval($leg['duration']['value']);
			}

			if($stream->getAttribute('state') === "started"){ // trip already started, nevermind which trip type
				$stream->setAttribute('endTime', $startTime + $diff);
			} else {
				if ($type === 'Travel/to' and $endTime) {
					if($endTime - $diff > time()) { // trip didn't started and still in the future
						$stream->setAttribute('startTime', $endTime - $diff);
					} else { // trip didn't started but time already gone
						if (!$startTime) {
							$startTime = time(); // best you can do is leave immediately
							$stream->setAttribute('startTime', $startTime);
						}
						$stream->setAttribute('endTime', $startTime + $diff);
					}
				}elseif($type === 'Travel/from' and $startTime) {
					if($startTime + $diff > time()) { // trip didn't started and still in the future
						$stream->setAttribute('endTime', $startTime + $diff);
					} else { // trip didn't started but time already gone
						if (!$startTime) {
							$startTime = time(); // best you can do is leave immediately
							$stream->setAttribute('startTime', $startTime);
						}
						$stream->setAttribute('endTime', $startTime + $diff);
					}
				}
			}
		}
		
		// return the result
		$stream->directions = Q::json_encode($result);
		return $result;
	}
	/* * * */
	/**
	 * Implements the __set_state method, so it can work with
	 * with var_export and be re-imported successfully.
	 * @method __set_state
	 * @param {array} $array
	 * @return {Travel_Trip} Class instance
	 */
	static function __set_state(array $array) {
		$result = new Travel_Trip();
		foreach($array as $k => $v)
			$result->$k = $v;
		return $result;
	}
}