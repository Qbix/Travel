module.exports = function(options, callback){
	options.url = this.getInstruction("link");
	options.icon = this.getInstruction("icon"); //"http://www.freeiconspng.com/uploads/alert-icon-red-11.png"

	callback();
};