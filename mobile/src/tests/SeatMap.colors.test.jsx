import { describe, test, expect } from 'vitest';
import { seatStatusClass, seatPaymentUrgency, seatColorClass, seatDueDate } from '../pages/SeatMap';

function seatWith(timeline, status = 'available') {
  return { status, timeline };
}

describe('seat map — structural status vs. payment color', () => {
  test('an empty seat is available regardless of urgency data', () => {
    expect(seatStatusClass(seatWith([]))).toBe('available');
    expect(seatColorClass(seatWith([]))).toBe('available');
  });

  test('a disabled seat stays disabled-colored even if (hypothetically) it had a timeline', () => {
    expect(seatColorClass(seatWith([{ startTime: '06:00', endTime: '12:00', paymentUrgency: 'overdue' }], 'disabled'))).toBe('disabled');
  });

  test('an occupied seat with no payment urgency data keeps the plain "occupied" color', () => {
    const seat = seatWith([{ startTime: '06:00', endTime: '12:00', paymentUrgency: 'ok' }]);
    expect(seatStatusClass(seat)).toBe('occupied');
    expect(seatColorClass(seat)).toBe('occupied');
  });

  test('an occupied seat due within 7 days gets the due_soon color tier', () => {
    const seat = seatWith([{ startTime: '06:00', endTime: '12:00', paymentUrgency: 'due_soon' }]);
    expect(seatColorClass(seat)).toBe('occupied urgency-due_soon');
  });

  test('an occupied seat due today gets the due_today color tier', () => {
    const seat = seatWith([{ startTime: '06:00', endTime: '12:00', paymentUrgency: 'due_today' }]);
    expect(seatColorClass(seat)).toBe('occupied urgency-due_today');
  });

  test('an occupied seat past due gets the overdue color tier', () => {
    const seat = seatWith([{ startTime: '06:00', endTime: '12:00', paymentUrgency: 'overdue' }]);
    expect(seatColorClass(seat)).toBe('occupied urgency-overdue');
  });

  test('a shared seat (two non-overlapping students) colors by the worse of the two payment statuses', () => {
    const seat = seatWith([
      { startTime: '06:00', endTime: '12:00', paymentUrgency: 'due_soon' },
      { startTime: '12:00', endTime: '18:00', paymentUrgency: 'overdue' },
    ]);
    expect(seatStatusClass(seat)).toBe('partial');
    expect(seatPaymentUrgency(seat)).toBe('overdue');
    expect(seatColorClass(seat)).toBe('partial urgency-overdue');
  });

  test('a scheduling conflict (overlapping times) keeps its conflict color, never a payment color', () => {
    const seat = seatWith([
      { startTime: '06:00', endTime: '14:00', paymentUrgency: 'overdue' },
      { startTime: '10:00', endTime: '18:00', paymentUrgency: 'ok' },
    ]);
    expect(seatStatusClass(seat)).toBe('conflict');
    expect(seatColorClass(seat)).toBe('conflict');
  });
});

describe('seatDueDate — matches whichever allocation drives the worst urgency', () => {
  test('an empty seat has no due date', () => {
    expect(seatDueDate(seatWith([]))).toBeNull();
  });

  test('a single occupant\'s due date is used directly', () => {
    const seat = seatWith([{ startTime: '06:00', endTime: '12:00', paymentUrgency: 'due_soon', paymentDueDate: '2026-09-01' }]);
    expect(seatDueDate(seat)).toBe('2026-09-01');
  });

  test('for a shared seat, the due date matches the worse-urgency occupant, not just the last one in the list', () => {
    const seat = seatWith([
      { startTime: '06:00', endTime: '12:00', paymentUrgency: 'due_soon', paymentDueDate: '2026-09-01' },
      { startTime: '12:00', endTime: '18:00', paymentUrgency: 'overdue', paymentDueDate: '2026-08-01' },
    ]);
    expect(seatPaymentUrgency(seat)).toBe('overdue');
    expect(seatDueDate(seat)).toBe('2026-08-01');
  });
});
