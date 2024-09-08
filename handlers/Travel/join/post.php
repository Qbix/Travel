<?php
/**
 * @module Travel
 */

/**
 * Used to join the trip as a passenger
 * @class HTTP Travel join
 * @method post
 * @param $_REQUEST
 * @param {string} $_REQUEST.publisherId Required. The id of the trip's publisher (driver)
 * @param {string} $_REQUEST.streamName Required. The name of the trip's stream
 * @param {array} $coordinates The coordinates of the pickup point
 * @param {double} $coordinates.latitude
 * @param {double} $coordinates.longitude
 * @param {string} [$coordinates.address] Additional address information may be useful
 * @param [$_REQUEST.userId=Users::loggedInUser(true)->id] The id of the passenger.
 * @return void
 */
function Travel_join_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('coordinates', 'streamName', 'publisherId');
	Q_Valid::requireFields($required, $r, true);
	$publisherId = $r['publisherId'];
	$streamName = $r['streamName'];
	if (!Q::startsWith($streamName, 'Travel/trip/')) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'streamName',
			'range' => 'something starting with Travel/trip/'
		));
	}

	$userId = Q::ifset($r, 'userId', false) ? $r['userId'] : Users::loggedInUser(true)->id;
	$stream = Streams_Stream::fetch($userId, $publisherId, $streamName, true, array(
		'withParticipant' => true
	));
	$coordinates = $r['coordinates'];
	if (!is_array($coordinates)) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'coordinates',
			'range' => 'coordinates[latitude] and coordinates[longitude]'
		));
	}
	Travel_Trip::join($stream, $userId, $coordinates);
	Q_Response::setSlot('stream', $stream);
}