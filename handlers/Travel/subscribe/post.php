<?php
/**
 * @module Travel
 */

/**
 * Used to subscribe user to location
 * @class HTTP Travel subscribe
 * @method post
 * @param $_REQUEST
 * @param {string} $_REQUEST.type Required. Trip type (Travel/to, Travel/from)
 * @param {array} $_REQUEST.location Required. array("latitude" => ..., "longitude" => ...), array("placeId" => ...), array("address" => ...)
 * @return void
 */
function Travel_subscribe_post($params)
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
	$participants = array();

	// get or create Places/nearby category streams
	// here we should use exactly "streams" method,
	// because these streams may be didn't created yet
	$streams = Places_Nearby::streams(
		$communityId,
		$location["latitude"],
		$location["longitude"],
		array(
			'forSubscribers' => true,
			'meters' => $distance,
			'skipAccess' => true
		)
	);

	// subscribe to only one stream
	$streams = array_slice($streams, 0, 1);

	$participants = Streams::subscribe($currentUserId, $communityId, $streams, array(
		"skipAccess" => true,
		"untilTime" => time() + 24*60*60 // limit subscription to 24 hours
	));
}