/** Only controlled messages/codes are logged: driver errors may contain credentials or SQL. */
export function startupFailure(error: unknown, port: number) {
  const messages = {
    EADDRINUSE: `Port ${port} sudah digunakan. Gunakan port lain untuk proses backend tambahan.`,
    ECONNREFUSED: 'Koneksi MySQL ditolak. Pastikan MySQL aktif dan host/port DATABASE_URL benar.',
    ETIMEDOUT:
      'Koneksi MySQL melewati batas waktu. Periksa jaringan, firewall, dan host/port database.',
    ENOTFOUND: 'Host MySQL tidak ditemukan. Periksa hostname pada DATABASE_URL.',
    ER_ACCESS_DENIED_ERROR: 'Autentikasi MySQL ditolak. Periksa user, password, dan izin database.',
    ER_BAD_DB_ERROR:
      'Database MySQL tidak ditemukan. Siapkan database tujuan sebelum menjalankan backend.',
    ER_NO_SUCH_TABLE:
      'Struktur database MySQL belum lengkap. Jalankan migration sebelum memulai backend.',
    HANDSHAKE_NO_SSL_SUPPORT:
      'Server MySQL tidak mendukung TLS yang diminta. Cocokkan konfigurasi TLS server dan DATABASE_SSL.',
    HANDSHAKE_SSL_ERROR: 'Koneksi TLS MySQL gagal. Periksa sertifikat dan konfigurasi CA server.',
  };
  const knownCode = (code: unknown): code is keyof typeof messages =>
    typeof code === 'string' && Object.hasOwn(messages, code);
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  while (pending.length && visited.size < 20) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if ('code' in current && knownCode(current.code))
      return { code: current.code, message: messages[current.code] };
    if ('cause' in current) pending.push(current.cause);
    if ('errors' in current && Array.isArray(current.errors))
      pending.push(...current.errors.slice(0, 10));
  }
  const unsupported =
    'Database aplikasi memerlukan MySQL 8.4 LTS dengan InnoDB. MariaDB bukan target migrasi ini.';
  if (error instanceof Error && error.message === unsupported)
    return { code: 'MYSQL_UNSUPPORTED_SERVER', message: unsupported };
  return {
    code: 'STARTUP_FAILED',
    message: 'Backend gagal dimulai. Periksa konfigurasi backend dan log layanan database.',
  };
}
