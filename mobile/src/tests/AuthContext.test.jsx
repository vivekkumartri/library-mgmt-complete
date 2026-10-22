import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';

vi.mock('../services/api', () => {
  const post = vi.fn();
  const get = vi.fn(() => Promise.reject(new Error('not used in these tests')));
  return { default: { get, post } };
});

const biometricMocks = vi.hoisted(() => ({
  biometricsSupported: vi.fn(() => true),
  isBiometricAvailable: vi.fn(async () => true),
  hasStoredBiometricLogin: vi.fn(async () => false),
  enableBiometricLogin: vi.fn(async () => {}),
  disableBiometricLogin: vi.fn(async () => {}),
  unlockWithBiometrics: vi.fn(async () => ({ username: 'admin-1', refreshToken: 'stored-rt' })),
}));
vi.mock('../utils/biometricAuth', () => biometricMocks);

const pushMocks = vi.hoisted(() => ({
  registerForPushNotifications: vi.fn(async () => {}),
  unregisterPushNotifications: vi.fn(async () => {}),
}));
vi.mock('../utils/pushNotifications', () => pushMocks);

import api from '../services/api';

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="user">{auth.user ? auth.user.id : 'none'}</span>
      <span data-testid="hasBiometrics">{String(auth.hasBiometricsEnabled)}</span>
      <button onClick={() => auth.loginAsAdmin('admin@example.com', 'pw', { wantsRefreshToken: true })}>login</button>
      <button onClick={() => auth.loginWithBiometrics()}>unlock</button>
      <button onClick={() => auth.enableBiometrics()}>enable</button>
      <button onClick={() => auth.logout()}>logout</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  biometricMocks.biometricsSupported.mockReturnValue(true);
  biometricMocks.isBiometricAvailable.mockResolvedValue(true);
  biometricMocks.hasStoredBiometricLogin.mockResolvedValue(false);
  biometricMocks.unlockWithBiometrics.mockResolvedValue({ username: 'admin-1', refreshToken: 'stored-rt' });
});

describe('AuthContext — session persistence', () => {
  test('loginAsAdmin stores the JWT and user in localStorage and exposes them via context', async () => {
    api.post.mockResolvedValueOnce({ data: { token: 'jwt-1', user: { id: 'admin-1', role: 'staff' }, refreshToken: 'rt-1' } });
    renderProbe();

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin-1'));
    expect(localStorage.getItem('lib_token')).toBe('jwt-1');
    expect(JSON.parse(localStorage.getItem('lib_user')).id).toBe('admin-1');
  });

  test('registers this device for push notifications after a successful login', async () => {
    api.post.mockResolvedValueOnce({ data: { token: 'jwt-1', user: { id: 'admin-1', role: 'staff' } } });
    renderProbe();

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(pushMocks.registerForPushNotifications).toHaveBeenCalled());
  });
});

describe('AuthContext — biometric unlock', () => {
  test('loginWithBiometrics exchanges the stored refresh token via /auth/refresh and re-saves the rotated one', async () => {
    api.post.mockResolvedValueOnce({ data: { token: 'jwt-2', user: { id: 'admin-1', role: 'staff' }, refreshToken: 'rt-2' } });
    renderProbe();

    fireEvent.click(screen.getByText('unlock'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'stored-rt' }));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin-1'));
    expect(biometricMocks.enableBiometricLogin).toHaveBeenCalledWith({ username: 'admin-1', refreshToken: 'rt-2' });
  });

  test('enableBiometrics stores the most recently issued refresh token', async () => {
    api.post.mockResolvedValueOnce({ data: { token: 'jwt-1', user: { id: 'admin-1', role: 'staff' }, refreshToken: 'rt-1' } });
    renderProbe();
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin-1'));

    fireEvent.click(screen.getByText('enable'));

    await waitFor(() => expect(biometricMocks.enableBiometricLogin).toHaveBeenCalledWith({ username: 'admin-1', refreshToken: 'rt-1' }));
  });
});

describe('AuthContext — logout', () => {
  test('revokes the current refresh token, clears biometric storage, and clears local session state', async () => {
    api.post
      .mockResolvedValueOnce({ data: { token: 'jwt-1', user: { id: 'admin-1', role: 'staff' }, refreshToken: 'rt-1' } })
      .mockResolvedValueOnce({ data: { success: true } });
    renderProbe();
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin-1'));

    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'rt-1' }));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'));
    expect(biometricMocks.disableBiometricLogin).toHaveBeenCalled();
    expect(pushMocks.unregisterPushNotifications).toHaveBeenCalled();
    expect(localStorage.getItem('lib_token')).toBeNull();
  });

  test('logout with no issued refresh token on this session never calls /auth/logout', async () => {
    renderProbe();
    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'));
    expect(api.post).not.toHaveBeenCalledWith('/auth/logout', expect.anything());
  });
});
