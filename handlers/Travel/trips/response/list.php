<?php
	
function Travel_trips_response_list($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('publisherId', 'streamName', 'tripType', 'location');
	Q_Valid::requireFields($required, $r, true);

	// user id from REQUEST or logged in user
	$userId = Q::ifset($r, 'userId', Users::loggedInUser()->id);
	list($publisherId, $streamName, $tripType, $location) = array_values(Q::take($r, array('publisherId', 'streamName', 'tripType', 'location')));
	$point = array(
		'x' => $location["latitude"],
		'y' => $location["longitude"]
	);

	// resulting array
	$res = array();

	// this is subsidiary array to help sort $res array by distance
	$distances = array();

	// get all trips related to category stream
	$tripsRelated = Streams::related($userId, $publisherId, $streamName, true, array('type' => $tripType));

	foreach($tripsRelated[0] as $tripRelation){
		$fromPublisherId = $tripRelation->fromPublisherId;
		$fromStreamName = $tripRelation->fromStreamName;

		$stream = Streams_Stream::fetch($userId, $fromPublisherId, $fromStreamName);

		// preload this stream to client
		$stream->addPreloaded();

		// calculate closest distance
		$directions = $stream->directions;
		$directions = Q::json_decode($directions, true);
		$route = reset($directions['routes']);
		$polyline = Places::polyline($route);
		$closest = Places::closest($point, $polyline);

		// this is subsidiary array to help sort $res array by distance
		$distances[] = $closest["distance"];

		// this is res array which will be sorted by distance
		$res[] = array(
			"publisherId" => $fromPublisherId,
			"streamName" => $fromStreamName,
			"distance" => $closest["distance"]
		);
	}

	// sort res array by distance
	array_multisort($distances, $res);

	return $res;
}
