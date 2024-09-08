<?php
/**
 * @module Travel
 */

/**
 * Discontinue the trip, if you're a driver.
 * @class HTTP Travel discontinue
 * @method post
 * @param $_REQUEST
 * @param $_REQUEST.publisherId Required. The id of the trip's publisher
 * @param $_REQUEST.streamName Required. The id of the trip.
 * @return void
 */
function Travel_discontinue_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('publisherId', 'streamName');
	Q_Valid::requireFields($required, $r, true);
	$publisherId = $r['publisherId'];
	$userId = Users::loggedInUser(true)->id;
	if ($userId != $publisherId){
		throw new Users_Exception_NotAuthorized();
	}
	$streamName = $r['streamName'];
	if (!Q::startsWith($streamName, 'Travel/trip/')) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'streamName',
			'range' => 'something starting with Travel/trip/'
		));
	}
	$stream = Streams_Stream::fetch($userId, $publisherId, $streamName, true);

	Travel_Trip::discontinue($stream);
	Q_Response::setSlot('stream', $stream);
}
