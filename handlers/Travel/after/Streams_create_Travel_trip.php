<?php
	
function Travel_after_Streams_create_Travel_trip($params)
{
	$trip = $params['stream'];
	$type = $trip->getAttribute("type");
	$startTime = $trip->getAttribute("startTime");
	$endTime = $trip->getAttribute("endTime");

	if ($type === 'Travel/to') {
		$weight = $endTime;
	} else if ($type === 'Travel/from') {
		$weight = $startTime;
	} else {
		$weight = time();
	}

	$experienceId = Q::ifset($options, 'experienceId', 'main');
	$experienceIds = is_array($experienceId) ? $experienceId : array("$experienceId");
	$communityId = Users::communityId();
	$streamType = "Travel/trips";
	foreach ($experienceIds as $experienceId) {
		$streamName = $streamType . "/" . $experienceId;
		$categoryStream = Streams_Stream::fetch($communityId, $communityId, $streamName);

		if (empty($categoryStream)) {
			$categoryStream = Streams::create($communityId, $communityId, $streamType, array(
				"name" => $streamName
			));
		}

		$trip->relateTo($categoryStream, 'Travel/trip', null, array(
			'skipAccess' => true,
			'weight' => $weight
		));
	}
}