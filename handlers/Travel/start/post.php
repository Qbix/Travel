<?php
/**
 * @module Travel
 */

/**
 * Only for driver!!! Start trip actions.
 * @class HTTP Travel start
 * @method post
 * @param {array} $_REQUEST
 * @param {string} $_REQUEST.publisherId Required. The id of the trip's publisher
 * @param {string} $_REQUEST.streamName Required. The name of the trip's stream
 * @param {array} $_REQUEST.coordinates
 * @param {double} $_REQUEST.coordinates.latitude
 * @param {double} $_REQUEST.coordinates.longitude
 * @param {double} $_REQUEST.coordinates.heading
 * @return void
 */
function Travel_start_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('publisherId', 'streamName');
	Q_Valid::requireFields($required, $r, true);
	$publisherId = $r['publisherId'];
	$streamName = $r['streamName'];
	$coordinates = Q::ifset($r, 'coordinates', null);
	if (!Q::startsWith($streamName, 'Travel/trip/')) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'streamName',
			'range' => 'something starting with Travel/trip/'
		));
	}
	$asUserId = Users::loggedInUser(true)->id;
	$stream = Streams_Stream::fetch($asUserId, $publisherId, $streamName, true);
	Travel_Trip::start($stream, $asUserId, $coordinates);
	Q_Response::setSlot('stream', $stream);
}