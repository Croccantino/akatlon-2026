#!/usr/bin/env bash
# Genera una CA locale + certificato HTTPS per FireTracker.
# Va rilanciato se cambia l'IP della rete (lo fa firetraker in automatico).
set -e
cd /home/zompi/disco_win/akalon
mkdir -p certs
cd certs

# IP IPv4 attuali (esclusi docker/virtuali, tenuti gli IP LAN 10.x/172.x/192.168.x)
IP_LIST=$(ip -4 -o addr show scope global | awk '$2 !~ /^(docker|br-|virbr|veth|tun|tap|ppp|dummy|vboxnet|vmnet|wg)/ {split($4,a,"/"); print a[1]}' || true)
# mantieni anche eventuali IP salvati prima con san-ip
if [ -f ips.txt ]; then
  IP_LIST="$IP_LIST $(cat ips.txt)"
fi
IP_LIST=$(echo "$IP_LIST" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
printf '%s\n' "$IP_LIST" > ips.txt.new

if [ -f ips.txt ] && cmp -s ips.txt ips.txt.new && [ -f server-cert.pem ] && [ -f ca-cert.pem ]; then
  rm -f ips.txt.new
  echo "Certificato gia' aggiornato per gli IP attuali."
  exit 0
fi
mv -f ips.txt.new ips.txt

# CA (generata una sola volta, va installata sui dispositivi)
if [ ! -f ca-key.pem ] || [ ! -f ca-cert.pem ]; then
  openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
    -keyout ca-key.pem -out ca-cert.pem -subj "/CN=FireTracker CA" \
    -addext "basicConstraints=critical,CA:TRUE" 2>/dev/null
fi

# SAN con tutti gli IP + localhost
SAN="DNS:localhost,IP:127.0.0.1"
for ip in $IP_LIST; do
  SAN="$SAN,IP:$ip"
done

openssl req -newkey rsa:2048 -nodes -new \
  -keyout server-key.pem -out server.csr -subj "/CN=FireTracker" 2>/dev/null

printf 'basicConstraints=CA:FALSE\nsubjectAltName=%s\n' "$SAN" > ext.cnf
openssl x509 -req -days 825 -in server.csr -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out server-cert.pem -extfile ext.cnf 2>/dev/null
rm -f server.csr ext.cnf

echo "Certificato HTTPS rigenerato per gli IP: $IP_LIST"
echo "Per la posizione dal telefono: installa certs/ca-cert.pem sul dispositivo come 'Certificato CA'."