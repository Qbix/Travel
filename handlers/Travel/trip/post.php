<?php
/**
 * @module Travel
 */

/**
 * Used to create Travel/trip stream.
 * @class HTTP Travel trip
 * @method post
 * @param $_REQUEST
 * @param {string} $_REQUEST.type the type of the trip, should be be "Travel/from" or "Travel/to"
 * @param {array} $_REQUEST.from Required. Must contain "userId", "placeId", or "latitude" and "longitude"
 * @param {array} $_REQUEST.to Required. Must contain "userId", "placeId", or "latitude" and "longitude"
 * @param {string} $_REQUEST.venue Required. The name of the destination venue.
 * @param {integer} $_REQUEST.peopleMax Required. Max amount of people the car can fit, including driver
 * @param {boolean} [$_REQUEST.offerFromToo] Boolean flag indicate if driver offers "from" trip also. Please set "departTime" option in this case.
 * @param {array} $_REQUEST.relateTo
 * @param {string} $_REQUEST.relateTo.publisherId
 * @param {string} $_REQUEST.relateTo.streamName
 * @param {integer} $_REQUEST.arriveTime Unix timestamp. Time when "to" trip should arrive.
 * @param {integer} [$_REQUEST.departTime] Unix timestamp. Time when "from" trip should start.
 * @param {integer} [$_REQUEST.detourMax] Maximum minutes driver can spend driving to pick up passengers.
 * @param {string|array} [$_REQUEST.labels] Labels of the users who can see the trip. If specified, the trip is not accessible to the public.
 */
function Travel_trip_post($params)
{
	$user = Users::loggedInUser(true);
	$r = array_merge($_REQUEST, $params);
	$required = array('from', 'to', 'peopleMax', 'type');
	Q_Valid::requireFields($required, $r, true);

	if(!Q::ifset($r, "to", "venue")){
		throw new Q_Exception_RequiredField(array('field' => 'venue'));
	}

	if (!in_array($r['type'], array('Travel/to', 'Travel/from'))) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'type',
			'range' => '"Travel/to" or "Travel/from"'
		));
	}
	$recurringInfo = Q::ifset($r, 'recurring', null);
	$attributes = Q::take($r, array('from', 'to', 'type', 'labels'));
	$attributes["venue"] = $r["to"]["venue"];
	if (isset($r['peopleMax'])) {
		$attributes['peopleMax'] = (int)$r['peopleMax'];
	}
	if (isset($r['detourMax'])) {
		$attributes['detourMax'] = (float)$r['detourMax'];
	}
	if (isset($r['detourType'])) {
		$attributes['detourType'] = $r['detourType'];
	}

	// arriveTime define only for Travel/to, because departTime will calculate after route
	if ($r['type'] == "Travel/to") {
		if (isset($r['arriveTime'])) {
			$attributes['endTime'] = Q_Utils::timestamp($r['arriveTime']);
		}

		$title = "Ride to: ".$r["to"]["venue"];
	}

	// departTime define only for Travel/from, because arriveTime will calculate after route
	if ($r['type'] == "Travel/from") {
		if (isset($r['departTime'])) {
			$attributes["startTime"] = Q_Utils::timestamp($r["departTime"]);
		}

		$title = "Ride from: ".$r["from"]["venue"];
	}

	$fields = @compact('title', 'attributes', 'recurringInfo');
	$fields['publisherId'] = $user->id;

	if (empty($r['labels'])) { // if labels didn't defined - allow public access
		$fields['readLevel'] = Streams::$READ_LEVEL['max'];
		$fields['writeLevel'] = Streams::$WRITE_LEVEL['relate'];
		$fields['adminLevel'] = Streams::$ADMIN_LEVEL['invite'];
	} else { // if labels defined - refuse public access (granular access for labels selected will be applied later)
		$fields['readLevel'] = Streams::$READ_LEVEL['none'];
		$fields['writeLevel'] = Streams::$WRITE_LEVEL['none'];
		$fields['adminLevel'] = Streams::$ADMIN_LEVEL['none'];
	}

	// create trip stream
	$tripTo = Travel_Trip::create($user->id, $fields, Q::ifset($r, 'relateTo', array()));

	if (filter_var(Q::ifset($r, 'offerFromToo', false), FILTER_VALIDATE_BOOLEAN)){
		// driver wants to offer "from" trip too
		$fields["title"] = "Ride from: ".$r["to"]["venue"];
		$attributes = &$fields["attributes"];
		$attributes["type"] = "Travel/from";

		// for Travel/from endTime will calculate route
		unset($attributes['endTime']);
		$attributes["startTime"] = Q_Utils::timestamp($r["departTime"]);
		list($attributes["from"], $attributes["to"])
			= array($attributes["to"], $attributes["from"]);

		// create trip stream
		Travel_Trip::create(
			$user->id, $fields, Q::ifset($r, 'relateTo', array())
		);
	}

	// set just one of the trips in the response
	Q_Response::setSlot('stream', $tripTo["stream"]->exportArray());
	Q_Response::setSlot('participant', $tripTo["participant"]->exportArray());
}
