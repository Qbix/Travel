<?php
/**
 * handler for event Calendars/recurring/Travel/recurring
 * If driver change recurring days - change recurring category days also
 * Because other users can't participate other days than driver, because without driver no trip.
 * @method Calendars_recurring_Travel_recurring
 * @param {array} $params
 * @param {Streams_Participant} $params.participant Participant row changed.
 */
function Calendars_recurring_Travel_recurring($params) {
	$participant = $params["participant"];

	// if participant not a driver - exit
	if ($participant->userId != $participant->publisherId) {
		return;
	}

	$recurringCategory = Streams_Stream::fetch($participant->publisherId, $participant->publisherId, $participant->streamName);
	$recurringCategory->setAttribute("days", $participant->getExtra("days"));
	$recurringCategory->save();
}