"""Shared Playwright helpers: serve a directory, mirror GitHub sample hosts to local fixtures."""
import http.server, json, os, pathlib, socketserver, threading, functools, urllib.parse

FIX = pathlib.Path(__file__).parent / 'fixtures'

def serve(directory, port=0):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    class Quiet(handler.func):
        def log_message(self, *a):
            pass
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(directory)))
    httpd.daemon_threads = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}/'

def _dirt_json():
    d = json.loads((FIX / 'dirt.json').read_text())
    return d

def route_samples(context, log=None):
    """Answer raw.githubusercontent.com requests from the local mirror; anything missing gets 404."""
    dough = {
        'felixroos/dough-samples/main/': 'dough-',
    }
    def handler(route, request):
        url = request.url
        path = urllib.parse.urlparse(url).path
        body = None
        ctype = 'application/octet-stream'
        if path.endswith('/strudel.json') and 'dirt-samples' in path.lower():
            body = json.dumps(_dirt_json()).encode(); ctype = 'application/json'
        elif '/felixroos/dough-samples/' in path:
            name = path.rsplit('/', 1)[-1]
            f = FIX / ('dough-' + name)
            if f.exists():
                body = f.read_bytes(); ctype = 'application/json'
        elif '/todepond/samples/' in path:
            f = FIX / path.rsplit('/', 1)[-1]
            if f.exists():
                body = f.read_bytes(); ctype = 'application/json'
        elif '/tidalcycles/Dirt-Samples/master/' in path:
            rel = urllib.parse.unquote(path.split('/tidalcycles/Dirt-Samples/master/', 1)[1])
            f = FIX / 'dirt' / rel
            if f.exists():
                body = f.read_bytes(); ctype = 'audio/wav'
        if body is None:
            if log is not None:
                log.append(url)
            route.fulfill(status=404, body=b'not mirrored')
        else:
            route.fulfill(status=200, body=body, headers={'content-type': ctype, 'access-control-allow-origin': '*'})
    context.route('https://raw.githubusercontent.com/**', handler)
    # block every other external host so tests never depend on the network
    context.route(lambda u: u.startswith('http') and '127.0.0.1' not in u and 'raw.githubusercontent.com' not in u,
                  lambda route, req: route.fulfill(status=404, body=b'offline'))

LAUNCH_ARGS = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream']
