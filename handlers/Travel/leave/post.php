<?php
/**
 * @module Travel
 */

/**
 * Used to leave the trip as a passenger
 * @class HTTP Travel leave
 * @method post
 * @param {array} $_REQUEST
 * @param {string} $_REQUEST.publisherId Required. The id of the trip's publisher (driver)
 * @param {string} $_REQUEST.streamName Required. The name of the trip's stream
 * @param [$_REQUEST.userId=Users::loggedInUser(true)->id] The id of the passenger.
 * @return void
 */
function Travel_leave_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('streamName', 'publisherId', 'userId');
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
	Travel_Trip::leave($stream, $userId);
	Q_Response::setSlot('stream', $stream);
}