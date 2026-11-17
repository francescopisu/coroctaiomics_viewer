"""Exercise binary integrity and compression policy through the ASGI boundary."""
import gzip
import unittest
from backend.server import ViewerGZipMiddleware

class TransferCompressionTests(unittest.IsolatedAsyncioTestCase):
    async def transfer(self,path,client='127.0.0.1'):
        original=bytes(range(256))*8192
        async def application(scope,receive,send):
            await send({'type':'http.response.start','status':200,'headers':[(b'content-type',b'application/octet-stream'),(b'content-length',str(len(original)).encode())]})
            # Preserve streaming behavior, rather than exercising only a small buffer.
            for offset in range(0,len(original),65536):
                await send({'type':'http.response.body','body':original[offset:offset+65536],'more_body':offset+65536<len(original)})
        messages=[]
        async def receive():return {'type':'http.request','body':b''}
        async def send(message):messages.append(dict(message))
        await ViewerGZipMiddleware(application,minimum_size=1024,compresslevel=1)(
            {'type':'http','path':path,'client':(client,1234),'headers':[(b'accept-encoding',b'gzip')]},receive,send)
        headers=dict(messages[0]['headers']);body=b''.join(m.get('body',b'') for m in messages[1:])
        decoded=gzip.decompress(body) if headers.get(b'content-encoding')==b'gzip' else body
        self.assertEqual(decoded,original)
        return headers

    async def test_loopback_native_ct_is_direct_and_byte_exact(self):
        for client in ['127.0.0.1','::1']:
            with self.subTest(client=client):
                headers=await self.transfer('/api/cases/8/assets/axial.volume.ct.bin',client)
                self.assertNotIn(b'content-encoding',headers)
                self.assertEqual(int(headers[b'content-length']),256*8192)

    async def test_masks_and_nonlocal_ct_remain_compressed_and_byte_exact(self):
        for path,client in [('/api/cases/8/assets/LAD.volume.cpe.bin','127.0.0.1'),('/api/cases/8/assets/axial.volume.ct.bin','192.0.2.1')]:
            with self.subTest(path=path,client=client):
                headers=await self.transfer(path,client)
                self.assertEqual(headers[b'content-encoding'],b'gzip')
                self.assertIn(b'Accept-Encoding',headers[b'vary'])
