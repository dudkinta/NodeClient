export class Lock {
  private locked: boolean;
  constructor() {
    this.locked = false;
  }

  async acquire() {
    while (this.locked) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.locked = true;
  }

  release() {
    this.locked = false;
  }
}
