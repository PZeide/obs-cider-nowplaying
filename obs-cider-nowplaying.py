import obspython
from flask import Flask, Response, send_file, stream_with_context, abort, request
from threading import Thread
import mimetypes
import requests
import base64
import logging

# Prevent the server from logging
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/javascript", ".js")

PORT = 12479

app = Flask(__name__)
server_thread = None

@app.route("/")
def send_index():
    return send_file("static/index.html")

@app.route("/corsfriendly")
def send_cors_friendly():
    url = request.args.get("url")

    if not url:
        abort(400)
    
    decoded_url = base64.b64decode(url)
    proxy_request = requests.get(decoded_url, stream=True)

    response = Response(stream_with_context(proxy_request.iter_content(chunk_size=4096)), 
                       content_type=proxy_request.headers["Content-Type"],
                       status=proxy_request.status_code)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

def script_load(settings):
    # Run the server in an other thread to avoid blocking main OBS thread.
    Thread(target=lambda: app.run(port=PORT), daemon=True).start()