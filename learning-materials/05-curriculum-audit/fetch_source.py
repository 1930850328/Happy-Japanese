"""Read only the requested TSV from CEJC's 78 MB public ZIP using HTTP ranges."""
import io
import urllib.parse
import urllib.request
import zipfile


def fetch(url, member_suffix=None):
    url = urllib.parse.quote(url, safe=':/%?=&')
    if member_suffix is None:
        with urllib.request.urlopen(url, timeout=45) as response:
            return response.read()

    class RemoteZip(io.RawIOBase):
        def __init__(self):
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=45) as response:
                self.size = int(response.headers['Content-Length'])
            self.position = 0

        def seekable(self):
            return True

        def tell(self):
            return self.position

        def seek(self, offset, whence=0):
            self.position = offset + (self.position if whence == 1 else self.size if whence == 2 else 0)
            if self.position < 0:
                raise ValueError('Negative ZIP seek')
            return self.position

        def read(self, size=-1):
            end = self.size if size < 0 else min(self.position + size, self.size)
            if end <= self.position:
                return b''
            requested = end - self.position
            req = urllib.request.Request(url, headers={'Range': f'bytes={self.position}-{end-1}'})
            with urllib.request.urlopen(req, timeout=45) as response:
                if response.status != 206:
                    raise ValueError('Source no longer supports ranges; restore the pinned TSV from a trusted copy')
                data = response.read()
            if len(data) != requested:
                raise ValueError('Incomplete ZIP range')
            self.position = end
            return data

    with zipfile.ZipFile(RemoteZip()) as archive:
        names = [n for n in archive.namelist() if n.endswith(member_suffix)]
        if len(names) != 1:
            raise ValueError('Ambiguous or missing ZIP member')
        return archive.read(names[0])  # zipfile validates CRC; caller also pins SHA-256
