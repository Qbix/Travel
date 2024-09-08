<?php
/**
 * @module Travel
 */

/**
 * Used to unsubscribe user from location
 * @class HTTP Travel unsubscribe
 * @method post
 * @param $_REQUEST
 * @param {string} $_REQUEST.type Required. Trip type (Travel/to, Travel/from)
 * @param {array} $_REQUEST.location Required. array("latitude" => ..., "longitude" => ...), array("placeId" => ...), array("address" => ...)
 * @return void
 */
function Travel_unsubscribe_post($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('type', 'location');
	Q_Valid::requireFields($required, $r, true);
	$type = $r['type'];
	$location = $r['location'];
	if (!in_array($type, array("Travel/to", "Travel/from"))) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'type',
			'range' => 'Travel/from or Travel/to'
		));
	}

	$currentUser = Users::loggedInUser();
	// if user doesn't logged just exit
	// I don't throw exception because non logged users should be able participate in trips too
	if(empty($currentUser)){
		return;
	}

	$currentUserId = $currentUser->id;
	$communityId = Users::communityId();
	$distance = Q_Config::expect('Travel', 'Trip', 'distances', 'subscribe');

	// get Places/nearby category streams
	$streams = array_keys(Places_Nearby::forSubscribers(
		$location["latitude"],
		$location["longitude"],
		$distance
	));

	Streams::unsubscribe($currentUserId, $communityId, $streams, array("skipAccess" => true));
}