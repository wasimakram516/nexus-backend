const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

/** Words for 1 to 999. */
function belowThousand(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) {
    const tens =
      rest < 20
        ? ONES[rest]
        : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ''}`;
    parts.push(hundreds ? `And ${tens}` : tens);
  }
  return parts.join(' ');
}

/**
 * An amount written out in English, such as `22875.00` becoming
 * "Twenty-Two Thousand, Eight Hundred And Seventy-Five". A fractional part is
 * written as "and 50/100".
 *
 * @param {string | number} amount - A non-negative amount with at most two decimals.
 * @returns {string} The words, "Zero" for nothing, or an empty string when the amount is not a usable number.
 */
export function amountInWords(amount: string | number): string {
  if (typeof amount === 'string' && amount.trim() === '') return '';
  const number = Number(amount);
  if (!Number.isFinite(number) || number < 0 || number >= 1e15) return '';
  const cents = Math.round(number * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;

  const groups: string[] = [];
  let remaining = whole;
  for (let scale = 0; remaining > 0; scale += 1) {
    const chunk = remaining % 1000;
    if (chunk) {
      groups.unshift(
        `${belowThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`,
      );
    }
    remaining = Math.floor(remaining / 1000);
  }
  const words = groups.length ? groups.join(', ') : 'Zero';
  return fraction
    ? `${words} and ${String(fraction).padStart(2, '0')}/100`
    : words;
}
