<?php
/**
 * @module Travel
 */

/**
 * Used to modify Travel/trip stream.
 * @class HTTP Travel trip
 * @method put
 * @param $_REQUEST
 * @param $_REQUEST.streamName Required. Trip stream name.
 * @param $_REQUEST.minutes Required. Minutes trip duration.
 * @param $_REQUEST.km Required. Km trip duration.
 * @param $_REQUEST.legs Required. Array of objects 
 *   {minutes: ..., timestamp: ..., km: ..., [userId: ...]}.
 *   Truncated analog of google legs.
 *   timestamp - estimated time when driver reach point
 *   userId - optional, if set - waypoint is a passenger
 * @param [$_REQUEST.startTime] Optional. Calculated start time for TO trip.
 * @param [$_REQUEST.endTime] Optional. Calculated end time for FROM trip.
 * @return void
 */
function Travel_trip_put($params)
{
	$r = array_merge($_REQUEST, $params);

	$required = array('streamName', 'minutes', 'km', 'legs');
	Q_Valid::requireFields($required, $r, true);
	$user = Users::loggedInUser(true);

	$tripStream = Streams_Stream::fetch($user->id, $user->id, $r["streamName"], true);

	if(!empty($r["startTime"])) {
		$tripStream->setAttribute("startTime", intval($r["startTime"]));
	}
	if(!empty($r["endTime"])) {
		$tripStream->setAttribute("endTime", intval($r["endTime"]));
	}

	$tripStream->setAttribute("minutes", $r["minutes"]);
	$tripStream->setAttribute("km", $r["km"]);
	$tripStream->setAttribute("legs", $r["legs"]);
	$tripStream->changed(); // this method do save too

	foreach($r["legs"] as $leg){
		if(empty($leg["userId"])) continue;

		// save to participant extra the time of pickup
		$participant = new Streams_Participant();
		$participant->publisherId = $tripStream->publisherId;
		$participant->streamName = $tripStream->name;
		$participant->userId = $leg["userId"];
		if (!$participant->retrieve()) {
			// this shouldn't happen, but just in case
			throw new Q_Exception_MissingRow(array(
				'table' => 'participant',
				'criteria' => http_build_query($participant->toArray(), '', ' & ')
			));
		}
		$participant->setExtra(array('pickUpTime' => intval($leg["timestamp"])));
		$participant->save();
	}

	Q_Response::setSlot('stream', $tripStream);
}