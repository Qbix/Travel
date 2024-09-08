<?php
	
function Travel_trips_response_content($params)
{
	$r = array_merge($_REQUEST, $params);

	$fromTime = Q::ifset($r, 'fromTime', time());
	$toTime = Q::ifset($r, 'toTime', $fromTime+60*60);
	$type = Q::ifset($r, 'type');
	$communityId = Users::communityId();
	$experienceId = Q::ifset($r, 'experienceId', 'main');
	$options = Q::take($r, array('latitude', 'longitude', 'meters'));
	$from = Places_Nearby::byTime(
		$communityId, 'Trips/from', $fromTime, $toTime, "Streams/experience/".$experienceId, $options
	);
	$to = Places_Nearby::byTime(
		$communityId, 'Trips/to', $fromTime, $toTime, "Streams/experience/".$experienceId, $options
	);
	// TODO: render the interface with tabs, and Places/trip/preview tools
	// Those tools will render themselves and batch-get the streams.
	// After it works, you can optimize it even more:
	// Just call Streams::fetch() for all related streams and then call
	// ->addPreloaded() for every stream object. So this way the streams
	// are already in the cache in the client, so it won't have to do another request for them.
	return 'TODO: read the comments in Travel/trips/response/content';
}