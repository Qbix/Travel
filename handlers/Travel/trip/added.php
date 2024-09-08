<?php
// default handler for event Travel/trip/added
// should return array of data for notification
function Travel_trip_added($params) {
	$tripStream = $params["tripStream"];

	// create group link
	$parts = explode("/", $tripStream->name);

	$notificationData = array(
		"link" => Q_Request::baseUrl()."/trip/".$tripStream->publisherId."/".end($parts)
	);

	return $notificationData;
}