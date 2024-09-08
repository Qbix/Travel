<?php
	
function Travel_trips_response_data($params)
{
	$r = array_merge($_REQUEST, $params);
	$required = array('publisherId', 'streamName');
	Q_Valid::requireFields($required, $r, true);

	// user id from REQUEST or logged in user
	$user = Users::loggedInUser();
	$userId = Q::ifset($r, 'userId', $user ? $user->id : '');
	list($publisherId, $streamName) = array_values(Q::take($r, array('publisherId', 'streamName')));

	$categoryStream = Streams_Stream::fetch($userId, $publisherId, $streamName, true);

	// resulting array with keys in ("Travel/to", "Travel/from")
	$res = array();

	// get all trips related to category stream
	$tripsRelated = Streams::related(
		$userId, $publisherId, $streamName, true, array(
			'type' => array("Travel/to", "Travel/from")
		)
	);

	foreach($tripsRelated[0] as $tripRelation){
		$relationType = $tripRelation->type;
		$fromPublisherId = $tripRelation->fromPublisherId;
		$fromStreamName = $tripRelation->fromStreamName;

		//$extra = $tripRelation->getExtra("state");

		// get trip stream
		$stream = Streams_Stream::fetch($userId, $fromPublisherId, $fromStreamName);
		$type = $stream->getAttribute("type");

		// get participants
		$participants = $stream->getParticipants(array(
			"state" => "participating"
		));

		// skip ended trips
		if($stream->getAttribute("state") == "ended"){
			continue;
		}

		// if user is a driver
		if($fromPublisherId === $userId){
			// if user is a driver to multiple trips - this is error!
			if(Q::ifset($res, $relationType, "driver", null)){
				//throw new Exception("Multiple driver! User can't be a driver to multiple trips with same direction and same time.");
			}

			$res[$relationType]["driver"] = array(
				"publisherId" => $userId,
				"streamName" => $fromStreamName,
				"participants" => $participants,
				"type" => $type
			);

			// no need further process, because driver can't be a passenger
			continue;
		}

		// get all trips related to current user
		$tripsRelatedToUser = Streams::related($userId, $userId, "Streams/participating", true, array(
			"type" => "Travel/trip",
			"where" => @compact("fromStreamName")
		));

		// if user is a passenger
		if(Q::ifset($tripsRelatedToUser, 0, null)){
			// if user is a driver and passenger to same direction at same time - this is error!
			if(Q::ifset($res, $relationType, "driver", null)){
				//throw new Exception("Multiple role! User can't be a driver and a passenger to same direction at same time.");
			}

			// if user is a passenger to multiple trips - this is error!
			if(Q::ifset($res, $relationType, "passenger", null)){
				throw new Exception("Multiple passenger! User can't be a passenger to multiple trips with same direction and same time.");
			}

			$res[$relationType]["passenger"] = array(
				"publisherId" => $fromPublisherId,
				"streamName" => $fromStreamName,
				"participants" => $participants,
				"type" => $type
			);
		}
	}

	// detect whether user subscribed to Places_Nearby streams
	$distance = Q_Config::expect('Travel', 'Trip', 'distances', 'subscribe');
	$location = Places_Location::fromStream($categoryStream);
	$results = Places_Nearby::forSubscribers($location["latitude"], $location["longitude"], $distance);
	$communityId = Users::communityId();
	foreach($results as $streamName => $data){
		$participation = Streams_Participant::select()->where(array(
			'publisherId' => $communityId,
			'streamName' => $streamName,
			'userId' => $userId,
			'subscribed' => 'yes',
			'state' => 'participating'
		))->limit(1)->fetchDbRow();

		if(!empty($participation)){
			$res["passengerSubscribed"] = true;
		}
	}



	return array(
		// TO trip stream where user is driver
		'driverTripTo' => Q::ifset($res, "Travel/to", "driver", ""),

		// FROM trip stream where user is a driver
		'driverTripFrom' => Q::ifset($res, "Travel/from", "driver", ""),

		// TO trip stream where user participated
		'passengerTripTo' => Q::ifset($res, "Travel/to", "passenger", ""),

		// FROM trip stream where user participated
		'passengerTripFrom' => Q::ifset($res, "Travel/from", "passenger", ""),

		// Places_Nearby streams user subscribed
		'passengerSubscribed' => Q::ifset($res, "passengerSubscribed", "")
	);
}