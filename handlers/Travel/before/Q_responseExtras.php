<?php

function Travel_before_Q_responseExtras()
{
	Q_Response::addScript('{{Travel}}/js/Travel.js', 'Travel');
	Q_Response::addStylesheet("{{Travel}}/css/Travel.css", 'Travel');
	Q_Response::setScriptData(
		"Q.plugins.Travel.Trip.distances",
		Q_Config::expect("Travel", "Trip", "distances")
	);
	Q_Response::setScriptData(
		"Q.plugins.Travel.Trip.states",
		Travel_Trip::$STATES
	);

	// default arrive time
	Q_Response::setScriptData(
		"Q.plugins.Travel.Trip.arriveTime",
		Q_Config::expect("Travel", "Trip", "arriveTime")
	);

	// default depart time
	Q_Response::setScriptData(
		"Q.plugins.Travel.Trip.departTime",
		Q_Config::expect("Travel", "Trip", "departTime")
	);
}
