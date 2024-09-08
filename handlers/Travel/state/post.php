<?php
/**
 * @module Travel
 */

/**
 * Trip members state handler.
 * @class HTTP Travel state
 * @method post
 * @param $_REQUEST
 * @param {string} $_REQUEST.publisherId Required. The id of the trip's publisher
 * @param {string} $_REQUEST.streamName Required. The name of the trip's stream
 * @param {string} $_REQUEST.state Required. The new state of the passenger.
 * @param {string} [$_REQUEST.userId=Users::loggedInUser(true)->id] Optional. The id of the passenger.
 * @return void
 */
function Travel_state_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('publisherId', 'streamName', 'userId', 'state');
	Q_Valid::requireFields($required, $r, true);
	$state = $r['state'];
	$luid = Users::loggedInUser(true)->id;
	$userId = Q::ifset($r, 'userId', $luid);
	$publisherId = $r['publisherId'];
	$streamName = $r['streamName'];
	if (!Q::startsWith($streamName, 'Travel/trip/')) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'streamName',
			'range' => 'something starting with Travel/trip/'
		));
	}
	$stream = Streams_Stream::fetch($userId, $publisherId, $streamName, true, array(
		'withParticipant' => true
	));
	if ($luid != $userId && $luid != $publisherId) {
		throw new Users_Exception_NotAuthorized();
	}
	Travel_Trip::setState($stream, $userId, $state);
	Q_Response::setSlot('stream', $stream);
}
