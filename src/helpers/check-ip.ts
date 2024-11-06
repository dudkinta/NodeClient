import { Multiaddr } from "@multiformats/multiaddr";

export function isLocalMultiAddress(addr: Multiaddr): boolean {
  // Парсим мультиадрес в строку
  const addrStr = addr.toString();

  // Проверка для локального IPv4 адреса (localhost и частные адреса)
  if (
    addrStr.includes("/ip4/127.") || // IPv4 localhost (127.0.0.0/8)
    addrStr.includes("/ip4/10.") || // IPv4 private network (10.0.0.0/8)
    addrStr.match(/\/ip4\/192\.168\.\d+\.\d+/) || // IPv4 private network (192.168.0.0/16)
    addrStr.match(/\/ip4\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/) // IPv4 private network (172.16.0.0 - 172.31.255.255)
  ) {
    return true;
  }

  // Проверка для локального IPv6 адреса (localhost и link-local addresses)
  if (
    addrStr.includes("/ip6/::1") || // IPv6 localhost (::1)
    addrStr.includes("/ip6/fe80:") || // IPv6 link-local (fe80::/10)
    addrStr.match(/\/ip6\/fc[0-9a-f]{2}/) || // IPv6 ULA (fc00::/7)
    addrStr.match(/\/ip6\/fd[0-9a-f]{2}/) // IPv6 ULA (fd00::/8)
  ) {
    return true;
  }
  return false;
}

export function isLocalAddress(addrStr: string): boolean {
  // Парсим мультиадрес в строку

  // Проверка для локального IPv4 адреса (localhost и частные адреса)
  if (
    addrStr.includes("/ip4/127.") || // IPv4 localhost (127.0.0.0/8)
    addrStr.includes("/ip4/10.") || // IPv4 private network (10.0.0.0/8)
    addrStr.match(/\/ip4\/192\.168\.\d+\.\d+/) || // IPv4 private network (192.168.0.0/16)
    addrStr.match(/\/ip4\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/) // IPv4 private network (172.16.0.0 - 172.31.255.255)
  ) {
    return true;
  }

  // Проверка для локального IPv6 адреса (localhost и link-local addresses)
  if (
    addrStr.includes("/ip6/::1") || // IPv6 localhost (::1)
    addrStr.includes("/ip6/fe80:") || // IPv6 link-local (fe80::/10)
    addrStr.match(/\/ip6\/fc[0-9a-f]{2}/) || // IPv6 ULA (fc00::/7)
    addrStr.match(/\/ip6\/fd[0-9a-f]{2}/) // IPv6 ULA (fd00::/8)
  ) {
    return true;
  }
  return false;
}

export function isDirect(address: string): boolean {
  const regex =
    /^\/ip4\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/[a-zA-Z0-9]+\/(\d{1,5})(\/ws)?(\/p2p\/[A-Za-z0-9]+)?$/;
  return regex.test(address);
}

export function isWEBRTC(address: string): boolean {
  const regex = /^\/webrtc\/p2p\/[A-Za-z0-9]+$/;
  return regex.test(address);
}
