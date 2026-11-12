// Version 9 has no DDL of its own (its tables live in schema.sql); it is only recorded,
// on every boot and idempotently, exactly as before the migrations moved to files.
export const repeatable = true;

export async function up() {}
