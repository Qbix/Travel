<?php
/**
 * handler for event Calendars/recurring/Travel/trip
 * Check whether new trip need to create and create if yes.
 * Also participate users to new trip.
 * @method Calendars_recurring_Travel_trip
 * @param {array} $params
 * @param {Streams_Stream} $params.relatedStream Recurring Trip stream
 * @param {Streams_Stream} $params.recurringStream Recurring category stream
 * @param {array} $params.relateTo Info about category stream for new trip created array(publisherId => ..., streamName => ...)
 * @return Streams_Stream|null New trip stream or null if error
 */
function Calendars_recurring_Travel_trip($params) {
	$tripStream = $params["relatedStream"];
	$recurringStream = $params["recurringStream"];
	$relateToEvent = Q::ifset($params, "relateToEvent", null);

	if (!$tripStream instanceof Streams_Stream) {
		throw new Exception("Calendars_recurring_Travel_trip: relatedStream not a stream");
	}

	if (!$recurringStream instanceof Streams_Stream) {
		throw new Exception("Calendars_recurring_Travel_trip: recurringStream not a stream");
	}

	$tripType = $tripStream->getAttribute("type");
	// get start time for UTC timezone
	$startTime = (int)$tripStream->getAttribute("startTime");
	$endTime = (int)$tripStream->getAttribute("endTime");

	// get current timestamp for UTC timezone
	$date_utc = (new DateTime(null, new DateTimeZone("UTC")))->getTimestamp();

	// if relateTo event defined, check whether last trip related to some event
	// and if not (for example because trip created first) - relate this trip to this event
	// else create new trip and relate to this event
	if ($relateToEvent instanceof Streams_Stream) {
		// if last trip doesn't related to some event - this is trip we looking for
		// else create new trip and return one
		if (!Travel_Trip::getEventByTrip($tripStream) instanceof Streams_Stream) {
			return $tripStream;
		}
	} elseif ($date_utc < $startTime) {
		// check if time to create new trip
		// if not - this trip is next recurring trip
		return $tripStream;
	}

	/************ CREATE NEW TRIP **********/

	// recurring info
	// IMPORTANT: recurringCategory should be inside this attribute
	// otherwise new recurring category will be created
	$recurringInfo = $recurringStream->getAllAttributes();
	// IMPORTANT: set current recurring category info. Otherwise new recurring category will created.
	$recurringInfo['recurringCategory']['publisherId'] = $recurringStream->publisherId;
	$recurringInfo['recurringCategory']['streamName'] = $recurringStream->name;

	$newStartTime = Calendars_Recurring::calculateTime($startTime, $recurringInfo);

	// if for some reason new start date didn't calculated - need to log this
	// return this method (not throw Exception) to allow further trips processing
	if (!$newStartTime) {
		return null;
	}

	// set current logged user to trip publisher
	Users::setLoggedInUser($tripStream->publisherId);

	$newEndTime = $newStartTime + ($endTime - $startTime);

	// collect fields for trip
	$fields = array(
		"title" => $tripStream->title,
		"attributes" => array(
			"labels" => $tripStream->getAttribute("labels"),
			"startTime" => $newStartTime,
			"endTime" => $newEndTime,
			"from" => $tripStream->getAttribute("from"),
			"to" => $tripStream->getAttribute("to"),
			"type" => $tripType
		),
		"readLevel" => $tripStream->readLevel,
		"writeLevel" => $tripStream->writeLevel,
		"adminLevel" => $tripStream->adminLevel,
		"recurringInfo" => $recurringInfo
	);

	// create trip
	$newTrip = Travel_Trip::create($tripStream->publisherId, $fields, $relateToEvent);
	$newTrip = Q::ifset($newTrip, 'stream', null);

	// if no new trip created - exit
	if (!$newTrip instanceof Streams_Stream) {
		return null;
	}

	/************ JOIN USERS TO NEW TRIP **********/

	// week day when trip will start
	$weekDay = date('D', (int)$newTrip->getAttribute("startTime"));

	// get all recurring participants
	$participants = Streams_Participant::select(array("userId", "extra"))
		->where(array(
			'state' => "participating",
			"publisherId" => $recurringStream->publisherId,
			"streamName" => $recurringStream->name
		))
		->execute()
		->fetchAll();

	foreach ($participants as $participant) {
		$extra = Q::json_decode($participant['extra']);

		// if user going that day - join him to trip
		if (in_array($weekDay, $extra->days)) {
			// set current logged user to participant
			Users::setLoggedInUser($participant['userId']);

			// join user to event
			Travel_Trip::join($newTrip, $participant['userId'], (array)$extra->coordinates);
		}
	}

	return $newTrip;
}