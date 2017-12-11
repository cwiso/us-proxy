console.log("Hello!");

var util = require("util");
var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();

function initDatabase(callback) {
	var db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		//db.run("DROP TABLE IF EXISTS data");
		db.run("CREATE TABLE IF NOT EXISTS data (ip TEXT PRIMARY KEY, port INT, type TEXT, code TEXT, country TEXT, anonymity TEXT, google TEXT, https TEXT, lastchecked TEXT)");
		callback(db);
	});
}

function updateRow(db, ip, port, country, anonymity, google, https, lastchecked, type) {
	var statementIn = db.prepare("INSERT OR IGNORE INTO data VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
	statementIn.run(ip, port, type, country, anonymity, google, https, lastchecked);
	statementIn.finalize();

	var statementUp = db.prepare("UPDATE data SET port = ?, type = ?, country = ?, anonymity = ?, google = ?, https = ?, lastchecked = ? WHERE ip LIKE ?");
	statementUp.run(port, type, country, anonymity, google, https, lastchecked, ip);
	statementUp.finalize();
}

function pad(str, max, char) {
	str = str.toString();
	return str.length < max ? pad(char + str, max, char) : str;
}

function readRows(db) {
	db.each("SELECT rowid AS id, ip, port, type, lastchecked FROM data", function(err, row) {
		if (err) return console.log("Error", util.inspect(err));
		console.log("[" + pad(row.id.toString(), 4, "0") + "] " + pad(row.type, 9, " ") + " - " + pad(row.ip, 15, " ") + ":" + row.port.toString() + (new Array(Math.max(6 - row.port.toString().length, 0)).join(" ")) + " - " + new Date(row.lastchecked).toGMTString());
	});
}

function cleanUp(db) {
	return new Promise(function(resolve, reject) {
		db.all("SELECT * FROM data", function(err, rows) {
			if (err) {
				reject();
				return console.log("Error", util.inspect(err));
			}
			rows.filter(function(row) {
				var d = new Date(row.lastchecked);
				var r;
				if (!(r = (d.setDate(d.getDate() + 7)) >= new Date())) {
					console.log("Removed proxy", pad(row.type, 9, " ") + " - " + pad(row.ip, 15, " ") + ":" + row.port.toString() + (new Array(Math.max(6 - row.port.toString().length, 0)).join(" ")) + " - " + new Date(row.lastchecked).toGMTString());
					db.run("DELETE FROM data WHERE ip = ?", row.ip);
				}
				return r;
			});
			resolve();
		});
	});
}

function fetchPage(url, callback) {
	request(url, function(error, response, body) {
		if (error) {
			console.log("Error requesting page: " + error);
			return;
		}

		callback(body);
	});
}

function scrapper(db, site, type) {
	return new Promise(function(resolve, reject) {
		fetchPage(site, function(body) {
			var $ = cheerio.load(body);

			var elements = $("#proxylisttable > tbody > tr");
			console.log()
			console.log("Found " + elements.length + " elements");
			elements.each(function() {
				var item = $(this).find("td");

				var ip = $(item[0]).text();
				var port = parseInt($(item[1]).text(), 10);
				var country = $(item[3]).text();
				var anonymity = $(item[4]).text();
				var google = $(item[5]).text();
				var https = $(item[6]).text();

				var d = new Date();
				var reg = /(1 day|\d+? days)? ?(1 hour|\d+? hours)? ?(1 minute|\d+? minutes)? ?(1 second|\d+? seconds)? ago/i;
				var last = $(item[7]).text();
				if (reg.test(last)) {
					var matches = last.match(reg);
					if (matches[1] != undefined) {
						d.setDate(d.getDate() - parseInt(matches[1], 10));
					}
					if (matches[2] != undefined) {
						d.setHours(d.getHours() - parseInt(matches[2], 10));
					}
					if (matches[3] != undefined) {
						d.setMinutes(d.getMinutes() - parseInt(matches[3], 10));
					}
					if (matches[4] != undefined) {
						d.setSeconds(d.getSeconds() - parseInt(matches[4], 10));
					}
				}

				var lastchecked = d.toJSON();

				updateRow(db, ip, port, country, anonymity, google, https, lastchecked, type);
			});
			resolve();
		});
	});
}

function run(db) {
	var scrappers = [];
	scrappers.push(scrapper(db, "http://free-proxy-list.net/", "free"));
	//skipped web proxies
	scrappers.push(scrapper(db, "http://sslproxies.org/", "ssl"));
	scrappers.push(scrapper(db, "http://us-proxy.org/", "us"));
	scrappers.push(scrapper(db, "http://free-proxy-list.net/uk-proxy.html", "uk"));
	scrappers.push(scrapper(db, "http://www.sslproxies24.top/", "ssl"));
	scrappers.push(scrapper(db, "https://list.proxylistplus.com/SSL-List-1", "ssl"));
	scrappers.push(scrapper(db, "http://newfreshproxies-24.blogspot.com/", "ssl"));
	scrappers.push(scrapper(db, "https://www.cool-proxy.net/proxies/http_proxy_list/country_code:US/port:/anonymous:", "us"));
	scrappers.push(scrapper(db, "http://www.freeproxylists.com/https/d1513006225.html", "us"));
	scrappers.push(scrapper(db, "http://proxydb.net/?protocol=http&protocol=https&anonlvl=2&anonlvl=3&anonlvl=4&country=&offset=0", "us"));
	scrappers.push(scrapper(db, "http://proxydb.net/?protocol=http&protocol=https&anonlvl=2&anonlvl=3&anonlvl=4&country=&offset=15", "us"));
	scrappers.push(scrapper(db, "http://proxydb.net/?protocol=http&protocol=https&anonlvl=2&anonlvl=3&anonlvl=4&country=&offset=30", "us"));
	scrappers.push(scrapper(db, "http://proxydb.net/?protocol=http&protocol=https&anonlvl=2&anonlvl=3&anonlvl=4&country=&offset=45", "us"));
	scrappers.push(scrapper(db, "http://proxydb.net/?protocol=http&protocol=https&anonlvl=2&anonlvl=3&anonlvl=4&country=&offset=60", "us"));
	//skipped socks4/socks5
	scrappers.push(scrapper(db, "http://google-proxy.net/", "google"));
	scrappers.push(scrapper(db, "http://free-proxy-list.net/anonymous-proxy.html", "anonymous"));

	Promise.all(scrappers).then(function() {
		cleanUp(db).then(function() {
			readRows(db);
		});
		db.close();
	});
}

initDatabase(run);
