import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPrivateKey, randomBytes, webcrypto, X509Certificate } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { stateDir } from './config.mjs';

x509.cryptoProvider.set(webcrypto);
const algorithm = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};
const serial = () => '01' + randomBytes(15).toString('hex');
const keyPEM = async (key) =>
  createPrivateKey({
    key: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', key)),
    format: 'der',
    type: 'pkcs8',
  }).export({ format: 'pem', type: 'pkcs8' });

export async function certificates(ip) {
  const dir = path.join(stateDir, 'tls');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), value, { mode: 0o600 });
  let caPEM, caKey;
  if (fs.existsSync(path.join(dir, 'ca.pem'))) {
    // Accept legacy PKCS#1 and new PKCS#8 keys without changing the trusted CA.
    caPEM = read('ca.pem');
    const der = createPrivateKey(read('ca-key.pem')).export({ type: 'pkcs8', format: 'der' });
    caKey = await webcrypto.subtle.importKey('pkcs8', der, algorithm, false, ['sign']);
  } else {
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    caKey = keys.privateKey;
    const ca = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: serial(),
      name: `CN=Orbit LAN ${os.hostname()} Root`,
      keys,
      signingAlgorithm: algorithm,
      notBefore: new Date(Date.now() - 86400_000),
      notAfter: new Date(Date.now() + 5 * 365 * 86400_000),
      extensions: [
        new x509.BasicConstraintsExtension(true, undefined, true),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
          true,
        ),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    caPEM = ca.toString('pem');
    write('ca.pem', caPEM);
    write('ca-key.pem', await keyPEM(caKey));
  }
  const ca = new X509Certificate(caPEM);
  let server;
  try {
    server = new X509Certificate(read('server.pem'));
  } catch {}
  if (
    !server ||
    !server.checkIP(ip) ||
    !server.verify(ca.publicKey) ||
    Date.parse(server.validTo) < Date.now() + 86400_000
  ) {
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const cert = await x509.X509CertificateGenerator.create({
      serialNumber: serial(),
      subject: 'CN=Orbit LAN',
      issuer: new x509.X509Certificate(caPEM).subject,
      publicKey: keys.publicKey,
      signingKey: caKey,
      signingAlgorithm: algorithm,
      notBefore: new Date(Date.now() - 86400_000),
      notAfter: new Date(Date.now() + 365 * 86400_000),
      extensions: [
        new x509.BasicConstraintsExtension(false),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
          true,
        ),
        new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
        new x509.SubjectAlternativeNameExtension(
          [...new Set([ip, '127.0.0.1'])]
            .map((value) => ({ type: 'ip', value }))
            .concat({ type: 'dns', value: 'localhost' }),
        ),
      ],
    });
    write('server.pem', cert.toString('pem'));
    write('server-key.pem', await keyPEM(keys.privateKey));
  }
  return {
    cert: read('server.pem'),
    key: read('server-key.pem'),
    caDER: ca.raw,
    fingerprint: ca.fingerprint256.toLowerCase(),
  };
}
