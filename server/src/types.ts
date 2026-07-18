export type Car = {
  year: number;
  make: string;
  model: string;
  miles: number;
  price: number;
  dealer: string;
  phone: string;
  target: number;
};

export function defaultTarget(price: number): number {
  return Math.round((price * 0.91) / 100) * 100;
}
