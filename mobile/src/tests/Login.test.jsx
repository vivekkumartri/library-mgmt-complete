import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import Login from '../pages/Login';

const mockAuth = {
  loginAsAdmin: vi.fn(),
  loginAsStudent: vi.fn(),
  loginWithBiometrics: vi.fn(),
  enableBiometrics: vi.fn(),
  biometricsSupported: false,
  biometricsAvailable: false,
  hasBiometricsEnabled: false,
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.biometricsSupported = false;
  mockAuth.biometricsAvailable = false;
  mockAuth.hasBiometricsEnabled = false;
});

describe('Login — password flow', () => {
  test('logs in as admin and navigates home when biometrics are not offered', async () => {
    mockAuth.loginAsAdmin.mockResolvedValueOnce({ user: { id: 'admin-1' } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(mockAuth.loginAsAdmin).toHaveBeenCalledWith('admin@example.com', 'secret123', { wantsRefreshToken: false }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/'));
  });

  test('shows a friendly error on invalid credentials', async () => {
    mockAuth.loginAsAdmin.mockRejectedValueOnce({ response: { data: { error: { message: 'Invalid email or password.' } } } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('Login — biometric opt-in after a fresh password login', () => {
  test('offers to enable biometrics when supported, available, and not yet enabled, and enabling calls enableBiometrics with the issued refresh token', async () => {
    mockAuth.biometricsSupported = true;
    mockAuth.biometricsAvailable = true;
    mockAuth.hasBiometricsEnabled = false;
    mockAuth.loginAsAdmin.mockResolvedValueOnce({ user: { id: 'admin-1' }, refreshToken: 'rt-abc123' });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(mockAuth.loginAsAdmin).toHaveBeenCalledWith('admin@example.com', 'secret123', { wantsRefreshToken: true }));
    await waitFor(() => expect(screen.getByText(/Use Face ID/i)).toBeInTheDocument());
    // Navigation is deferred until the user answers the offer.
    expect(navigateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Enable'));

    await waitFor(() => expect(mockAuth.enableBiometrics).toHaveBeenCalledWith('rt-abc123'));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/'));
  });

  test('declining the offer still navigates home without enabling biometrics', async () => {
    mockAuth.biometricsSupported = true;
    mockAuth.biometricsAvailable = true;
    mockAuth.hasBiometricsEnabled = false;
    mockAuth.loginAsAdmin.mockResolvedValueOnce({ user: { id: 'admin-1' }, refreshToken: 'rt-abc123' });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(screen.getByText(/Use Face ID/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Not now'));

    expect(mockAuth.enableBiometrics).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/'));
  });

  test('does not offer biometrics when they are already enabled', async () => {
    mockAuth.biometricsSupported = true;
    mockAuth.biometricsAvailable = true;
    mockAuth.hasBiometricsEnabled = true;
    mockAuth.loginAsAdmin.mockResolvedValueOnce({ user: { id: 'admin-1' } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(mockAuth.loginAsAdmin).toHaveBeenCalledWith('admin@example.com', 'secret123', { wantsRefreshToken: false }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/'));
  });
});

describe('Login — biometric unlock button', () => {
  test('shows the unlock button only when biometrics are supported and already enabled, and clicking it logs in', async () => {
    mockAuth.biometricsSupported = true;
    mockAuth.hasBiometricsEnabled = true;
    mockAuth.loginWithBiometrics.mockResolvedValueOnce({ user: { id: 'admin-1' } });
    renderLogin();

    const unlockButton = screen.getByText(/Unlock with Face ID/i);
    fireEvent.click(unlockButton);

    await waitFor(() => expect(mockAuth.loginWithBiometrics).toHaveBeenCalled());
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/'));
  });

  test('hides the unlock button when biometrics are not enabled', () => {
    mockAuth.biometricsSupported = true;
    mockAuth.hasBiometricsEnabled = false;
    renderLogin();

    expect(screen.queryByText(/Unlock with Face ID/i)).not.toBeInTheDocument();
  });

  test('a cancelled biometric prompt stays on the password form without an error', async () => {
    mockAuth.biometricsSupported = true;
    mockAuth.hasBiometricsEnabled = true;
    mockAuth.loginWithBiometrics.mockRejectedValueOnce(new Error('User cancelled'));
    renderLogin();

    fireEvent.click(screen.getByText(/Unlock with Face ID/i));

    await waitFor(() => expect(mockAuth.loginWithBiometrics).toHaveBeenCalled());
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });
});
