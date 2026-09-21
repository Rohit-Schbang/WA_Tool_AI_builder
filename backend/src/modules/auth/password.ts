import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

// Plain  password >>> Hashed 
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

//  Comapring the  password and the stored hashed password
export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
