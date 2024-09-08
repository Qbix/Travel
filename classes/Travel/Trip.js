/**
 * Class representing trip rows.
 *
 * This description should be revised and expanded.
 *
 * @module Travel
 */
var Q = require('Q');
var Db = Q.require('Db');
var Trip = Q.require('Base/Travel/Trip');

/**
 * Class representing 'Trip' rows in the 'Travel' database
 * @namespace Travel
 * @class Trip
 * @extends Base.Travel.Trip
 * @constructor
 * @param {Object} fields The fields values to initialize table row as
 * an associative array of {column: value} pairs
 */
function Travel_Trip (fields) {

	// Run mixed-in constructors
	Travel_Trip.constructors.apply(this, arguments);
	
	/*
 	 * Add any privileged methods to the model class here.
	 * Public methods should probably be added further below.
	 */
}

Q.mixin(Travel_Trip, Trip);

/*
 * Add any public methods here by assigning them to Travel_Trip.prototype
 */

/**
 * The setUp() method is called the first time
 * an object of this class is constructed.
 * @method setUp
 */
Travel_Trip.prototype.setUp = function () {
	// put any code here
	// overrides the Base class
};

module.exports = Travel_Trip;