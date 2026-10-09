var wSocketMngmtService;
var wSocketPinpad;
var urlWSPinpad = "ws://localhost:9100";
var urlWSMngmtService = "ws://localhost:10205";
var urlHttpPinpad = "http://localhost:10305";
var pinpadServiceVersion = "";
var clientPinPadId;
var eventCalls = new Map();
var responseCalls = new Map();
var isLogEnabled = "0";
var xhr = new XMLHttpRequest();

class TpvpcImplantado {
	
	initFnDll(args, onResponse)
	{
		WebSocketMsgmtDisConnect();
		WebSocketMsgmtConnect(function () {
			RegisterResponse("fnDllIniTpvpcLatente", onResponse, function() {
				execWSPinPadFunc("fnDllIniTpvpcLatente", args);
			});
		});
	}

	execFnDll(name, args, onResponse)
	{
		RegisterResponse(name, onResponse, function() {
			execWSPinPadFunc(name, args);
		});
	}

	subscribeEvent(name, onResponse) {
		RegisterEvent(name, onResponse);
	}

	EnableLog()
	{
		isLogEnabled = "1";
	}

	DisableLog()
	{
		isLogEnabled = "0";
	}

	HttpExecFnDll(name, args, pinpadId, onResponse) {
		onResponse(execHTTPPinPadFunc(name, args, pinpadId));
	}
}

function RegisterResponse(responseName, responseCall, onSuccess) {
	if (responseName != null && responseName != '') {
		let time = Date.now();
		responseCalls.set(responseName, { responseCall, time });
		setTimeout(() => {
			let fn = responseCalls.get(responseName);
			if (fn != null) {
				responseCalls.delete(responseName);
				log("[WS] Delete responsecallback " + responseName + " (" + responseCalls.size + ")");
			}
		}, "120000")
	}
	if (onSuccess) onSuccess();
}

function RegisterEvent(eventName, eventCall) {
	if (eventName != null && eventName != '') {
		let time = Date.now();
		eventCalls.set(eventName, { eventCall, time });
	}
}

function WebSocketMsgmtDisConnect() {
	if (WebSocketDisConnect()) {
		log('[MWS] closing to management service... ');
		if (wSocketMngmtService) wSocketMngmtService.close();
	}
}

function WebSocketMsgmtConnect(onConnected) {
	log('[MWS] Connecting to management service... ' + urlWSMngmtService);
	if (wSocketMngmtService && wSocketMngmtService.readyState == 1)
		log('[MWS] Already connected...');
	else {
		wSocketMngmtService = new WebSocket(urlWSMngmtService);
		wSocketMngmtService.onopen = function (event) {
			log('[MWS] onopen - Connected!');
			clientPinPadId = Date.now();
			_WebSocketSend(wSocketMngmtService, {
				ClientId: clientPinPadId.toString(),
				Command: "Init",
				Args: [isLogEnabled]
			});
		};
		wSocketMngmtService.onmessage = function (event) {
			log('[MWS] onmessage - ' + event.data);
			handleEventMngmtMessage(JSON.parse(event.data), onConnected);
		}
		wSocketMngmtService.onerror = function(event) {
			log("[MWS] onerror - " + event.data);
		};
		wSocketMngmtService.onclose = function(event) {
			log("[MWS] onclose - " + event.code + ' ' + event.reason);
		}
	}
}

function handleEventMngmtMessage(data, onConnected) {
	if (data.Command == 'managementService_Connected') {
		urlWSPinpad = "ws://" + data.DataResponse.PinPadAddress;
		urlHttpPinpad = "http://" + data.DataResponse.PinPadAddress;
		log("[MWS] version - " + data.DataResponse.Version);
		pinpadServiceVersion = data.DataResponse.Version;
		WebSocketConnect(onConnected);
	} else if (data.Body && data.Body.Command == 'IMPL_PAYMENT') {
		RegisterResponse("fnDllOperPinPad", (response) => {
			data.Body.ResponseCode = response.Response;
			data.Body.Response = response.Result;
			log("ENVIAR " + response);
			_WebSocketSend(wSocketMngmtService, data);
		}, () => {
			execWSPinPadFunc("fnDllOperPinPad", [data.Body.Amount, data.Body.Invoice, data.Body.Type]);
		});

	}
 
}

function WebSocketDisConnect() {
	log('[WS] Closing pinpad connection... ' + wSocketPinpad);
	if (wSocketPinpad) wSocketPinpad.close();
	return true;
}

function WebSocketConnect(onConnected) {
	log('[WS] Connecting to pinpad... ' + urlWSPinpad);
	if (wSocketPinpad && wSocketPinpad.readyState == 1)
		log('[WS] Pinpad already connected...');
	else
		wSocketPinpad = new WebSocket(urlWSPinpad);
	wSocketPinpad.onopen = function (event) {
		log('[WS] onopen - Pinpad connected!');
		if (onConnected) onConnected();
	};
	wSocketPinpad.onmessage = function (event) {
		log('[WS] onmessage - ' + event.data);
		handleMessage(event.data);
	}
	wSocketPinpad.onerror = function(event) {
		log("[WS] onerror - " + event.data);
	};
	wSocketPinpad.onclose = function(event) {
		log("[WS] onclose - " + event.code + ' ' + event.reason);
	}
}

function WebSocketClose() {
	log("[WS] close");
	wSocketPinpad.close();
}
function _WebSocketSend(wsocket, data) {
	var dataJson = JSON.stringify(data);
	log("[WS] send - " + dataJson);
	if (wsocket)
		wsocket.send(dataJson);
	else
		log("[WS] socket null");
		
}

function WebSocketPinPadSend(data) {
	_WebSocketSend(wSocketPinpad, data);
}

function WebHttpSend(data) {
	log("[HTTP] sending to " + urlHttpPinpad);
	xhr.open("POST", urlHttpPinpad, false);
	xhr.setRequestHeader("Content-Type", "application/json");
	var stringData = JSON.stringify(data);
	log("[HTTP] send " + stringData);
	xhr.send(stringData);
	if (xhr.readyState === 4) {
		if (xhr.status === 200) {
			log("[HTTP] receive - " + data.Type + data.Command + " " + xhr.responseText);
			var json = JSON.parse(xhr.responseText);
			return json;
		} else {
			log("[HTTP] error - " + "state " + xhr.readyState + " status " + xhr.status);
			var json = JSON.parse(xhr.responseText);
		}
	}
}

function WebHttpSendAsync(data, onSuccess) {
	xhr.open("POST", urlHttpPinpad, true);
	xhr.setRequestHeader("Content-Type", "application/json");
	var stringData = JSON.stringify(data);
	log("[HTTP] sendAsync " + stringData);
	xhr.onload = function (e) {
		if (xhr.readyState === 4) {
			if (xhr.status === 200) {
				log("[HTTP] receive - " + data.Type + data.Command + " " + xhr.responseText);
				var json = JSON.parse(xhr.responseText);
				if (onSuccess) onSuccess(json.Response);
			} else {
				log("[HTTP] error - " + "state " + xhr.readyState + " status " + xhr.status);
			}
		}
	};
	xhr.onerror = function (e) {
		log("[HTTP] error - " + "state " + xhr.readyState + " status " + xhr.status);
	};
	xhr.ontimeout = function (e) {
		log("[HTTP] timeout - " + xhr.timeout + " " + data.Type + data.Command);
	};
	xhr.send(stringData);
}

function handleMessage(data) {
	
	let json = JSON.parse(data);
	if (json.Type == "event") {
		handleEventMessage(json);
	} else if (json.Type == "response") {
		handleResponseMessage(json);
	} else {
		log('[WS] Message not handled - ' + data);
	}		
}


function handleResponseMessage(data) {
	let event = responseCalls.get(data.Command);
	if (event != null) {
		event.responseCall({
			"Response": data.Response,
			"Result": data.Result
		});
	} else {
		log('[WS] ResponseCallback not registered - ' + data);
	}
	log('Tam before ' + responseCalls.size);
	responseCalls.delete(data.Command);
	log('Tam ' + responseCalls.size);
}

function handleEventMessage(data) {
	let event = eventCalls.get(data.Command);
	if (event != null) {
		event.eventCall({
			"Response": data.Response,
			"Result": data.Result
		});
	} else {
		log('[WS] Event not registered - ' + data);
	}
}

function log(str) {
	if (isLogEnabled == "1")
		console.log(str);
}

function execWSPinPadFunc(name, values) {
	WebSocketPinPadSend({
		Type: "func",
		Command: name,
		Args: values
	});
}

function execHTTPPinPadFunc(name, values, pinpadId) {
	return WebHttpSend({
		PinpadId: pinpadId,
		Type: "func",
		Command: name,
		Args: values
	});
}

var maxLifespan = 2 * 60 * 1000 + 30 * 1000
// check once per second
// Acts like a garbage collector
setInterval(function checkItems() {
	for (let [key, value] of responseCalls) {
		if (Date.now() - maxLifespan > value.time) {
			log("Deleting response made at: " + value.time);
			responseCalls.delete(key);
		}
	}
}, 3 * 60 * 1000)

export {TpvpcImplantado};
