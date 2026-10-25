import { amountInWords } from './amount-in-words.util';

describe('amountInWords', () => {
  it.each([
    ['0', 'Zero'],
    ['5', 'Five'],
    ['13', 'Thirteen'],
    ['40', 'Forty'],
    ['99', 'Ninety-Nine'],
    ['100', 'One Hundred'],
    ['101', 'One Hundred And One'],
    ['22875', 'Twenty-Two Thousand, Eight Hundred And Seventy-Five'],
    ['22875.00', 'Twenty-Two Thousand, Eight Hundred And Seventy-Five'],
    ['1000', 'One Thousand'],
    ['1000000', 'One Million'],
    ['1002003', 'One Million, Two Thousand, Three'],
    [5350.5, 'Five Thousand, Three Hundred And Fifty and 50/100'],
    ['0.05', 'Zero and 05/100'],
  ])('writes %s as %s', (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });

  it.each(['', 'abc', '-1', '1e15', NaN])('gives nothing for %p', (amount) => {
    expect(amountInWords(amount as string)).toBe('');
  });

  it('rounds to the nearest cent instead of leaking a float error', () => {
    expect(amountInWords(0.1 + 0.2)).toBe('Zero and 30/100');
  });
});
