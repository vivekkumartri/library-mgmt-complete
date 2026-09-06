import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AddStudent from '../pages/AddStudent';
import '../i18n';

vi.mock('../services/api', () => {
  const get = vi.fn(() => Promise.resolve({ data: { floors: [], seats: [] } }));
  const post = vi.fn();
  return {
    default: { get, post },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

// Canvas drawing isn't supported in jsdom and is exercised by its own
// component tests elsewhere — stub it here so we can test the wizard flow
// around it (that it appears after creation when skipped in-wizard).
vi.mock('../components/SignaturePad', () => ({
  default: ({ onSaved, onCancel }) => (
    <div>
      <button onClick={onSaved}>Mock save signature</button>
      {onCancel && <button onClick={onCancel}>Mock skip signature</button>}
    </div>
  ),
}));

import api from '../services/api';

// The form's <label>/<input> pairs are siblings rather than a wrapping or
// htmlFor/id association, so they aren't reachable via getByLabelText —
// look up the input through its label's containing .field instead.
function fieldInput(labelText) {
  return screen.getByText(labelText).closest('.field').querySelector('input, textarea');
}

// Step 1 (Personal information) only requires full name + joining date
// (which defaults to today); mobile lives on step 2 and is validated there.
function fillStep0() {
  fireEvent.change(fieldInput('Full name *'), { target: { value: 'Rahul Kumar' } });
}
function fillStep1Mobile() {
  fireEvent.change(fieldInput('Mobile *'), { target: { value: '9999999999' } });
}

// Call once already on the Photo step (step 3). Advances through
// Photo/Signature/Seat allocation/Timing/Monthly fee — all skippable when
// seat allocation is left unchecked — landing on the Review & create step.
function skipToReview() {
  fireEvent.click(screen.getByText('Next')); // Photo -> Signature
  fireEvent.click(screen.getByText('Next')); // Signature -> Seat allocation
  fireEvent.click(screen.getByText('Next')); // Seat allocation -> Timing
  fireEvent.click(screen.getByText('Next')); // Timing -> Monthly fee
  fireEvent.click(screen.getByText('Next')); // Monthly fee -> Review & create
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(() => Promise.resolve({ data: { floors: [], seats: [] } }));
});

function renderWizard() {
  return render(
    <MemoryRouter>
      <AddStudent />
    </MemoryRouter>
  );
}

describe('AddStudent wizard', () => {
  test('blocks moving past step 1 without required fields', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Full name and joining date are required/i)).toBeInTheDocument();
    // Still on step 1 — the mobile field from step 2 shouldn't be visible yet.
    expect(screen.queryByText('Mobile *')).not.toBeInTheDocument();
  });

  test('blocks moving past step 2 (contact info) without a mobile number', () => {
    renderWizard();
    fillStep0();
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Mobile number is required/i)).toBeInTheDocument();
    // Still on step 2 — the review step's Create action shouldn't be visible yet.
    expect(screen.queryByText('Create student')).not.toBeInTheDocument();
  });

  test('walks through all steps (skipping optional photo/signature/seat) and submits', async () => {
    api.post.mockResolvedValueOnce({
      data: { student: { student_id: 'LIB-2026-0042' }, temporaryPassword: 'Xy7pQ2mN' },
    });

    renderWizard();

    fillStep0();
    fireEvent.click(screen.getByText('Next'));

    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Mobile number is required/i)).toBeInTheDocument();

    fillStep1Mobile();
    fireEvent.click(screen.getByText('Next'));

    skipToReview();

    // Review step — shows entered values before submit.
    expect(screen.getByText('Rahul Kumar')).toBeInTheDocument();
    expect(screen.getByText(/Skipped — allocate later/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Create student'));

    await waitFor(() => expect(screen.getByText('LIB-2026-0042')).toBeInTheDocument());
    expect(screen.getByText('Xy7pQ2mN')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/students', expect.objectContaining({ fullName: 'Rahul Kumar', mobile: '9999999999' }));
  });

  test('shows next-step actions right after creation, without a redundant re-capture-signature prompt', async () => {
    api.post.mockResolvedValueOnce({
      data: { student: { student_id: 'LIB-2026-0042' }, temporaryPassword: 'Xy7pQ2mN' },
    });

    renderWizard();
    fillStep0();
    fireEvent.click(screen.getByText('Next'));
    fillStep1Mobile();
    fireEvent.click(screen.getByText('Next'));
    skipToReview();
    fireEvent.click(screen.getByText('Create student'));

    await waitFor(() => expect(screen.getByText('Go to student profile')).toBeInTheDocument());
    expect(screen.getByText('Allocate a seat')).toBeInTheDocument();
    // The in-wizard Signature step already offered this — no second capture
    // prompt should reappear on the created-student screen.
    expect(screen.queryByText('Mock save signature')).not.toBeInTheDocument();
  });

  test('surfaces a backend error without losing the entered data', async () => {
    api.post.mockRejectedValueOnce({ response: { data: { error: { message: 'Mobile number already in use.' } } } });

    renderWizard();
    fillStep0();
    fireEvent.click(screen.getByText('Next'));
    fillStep1Mobile();
    fireEvent.click(screen.getByText('Next'));
    skipToReview();
    fireEvent.click(screen.getByText('Create student'));

    await waitFor(() => expect(screen.getByText('Mobile number already in use.')).toBeInTheDocument());
    // Still on the review step, not stuck on a blank/created screen.
    expect(screen.getByText('Create student')).toBeInTheDocument();
  });

  test('turning on seat allocation requires choosing a seat before advancing', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/floors') return Promise.resolve({ data: { floors: [{ floor_id: 'f1', floor_name: 'Floor 1' }] } });
      if (url === '/floors/f1/seats') return Promise.resolve({ data: { seats: [{ seat_id: 's1', seat_number: '1', status: 'available' }] } });
      return Promise.resolve({ data: {} });
    });

    renderWizard();
    fillStep0();
    fireEvent.click(screen.getByText('Next'));
    fillStep1Mobile();
    fireEvent.click(screen.getByText('Next')); // -> Photo (step 3)
    fireEvent.click(screen.getByText('Next')); // -> Signature
    fireEvent.click(screen.getByText('Next')); // -> Seat allocation

    fireEvent.click(screen.getByText(/Allocate a seat now/i));
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Choose a seat/i)).toBeInTheDocument();
  });
});
