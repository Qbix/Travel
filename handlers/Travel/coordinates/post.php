<?php
/**
 * @module Travel
 */

/**
 * Update the coordinates, heading, speed etc. of a driver or passenger in a trip
 * @class HTTP Travel coordinates
 * @method post
 * @param $_REQUEST
 * @param {string} $_REQUEST.publisherId Required. The id of the trip's publisher (driver)
 * @param {string} $_REQUEST.streamName Required. The streamName of the trip
 * @param {array} $_REQUEST.coordinates The coordinates of the pickup point
 * @param {double} $coordinates.latitude
 * @param {double} $coordinates.longitude
 * @param {double} [$coordinates.heading] useful for a driver, degrees clockwise from true north
 * @param {double} [$coordinates.speed] useful for a driver, meters per second in direction of heading
 * @param {string} [$coordinates.address] additional address information may be useful
 * @param [$_REQUEST.userId=Users::loggedInUser(true)->id] The id of the user whose coordinates are being updated.
 * @return void
 */
function Travel_coordinates_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('publisherId', 'streamName', 'coordinates');
	Q_Valid::requireFields($required, $r, true);
	$publisherId = $r['publisherId'];
	$streamName = $r['streamName'];
	if (!Q::startsWith($streamName, 'Travel/trip/')) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'streamName',
			'range' => 'something starting with Travel/trip/'
		));
	}
	$loggedUserId = Users::loggedInUser(true)->id;
	$userId = !empty($r['userId']) ? $r['userId'] : $loggedUserId;

	// coordinates can change only self logged user or driver
	if($userId !== $loggedUserId && $userId !== $publisherId){
		throw new Users_Exception_NotAuthorized();
	}

	$stream = Streams_Stream::fetch($userId, $publisherId, $streamName, true);
	$coordinates = $r['coordinates'];
	Travel_Trip::setCoordinates($stream, $userId, $coordinates);
	$stream->changed();
	Q_Response::setSlot('stream', $stream);
}