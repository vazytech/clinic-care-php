<?php
// Input checks for request bodies. Each helper returns a clean value or throws a
// 400 error with a message the user can act on.

declare(strict_types=1);

// Counts characters (not bytes), without needing the mbstring extension.
function char_length(string $s): int
{
    return preg_match_all('/./su', $s);
}

function v_text(mixed $value, string $label, bool $required = false, int $max = 500): string
{
    $v = is_scalar($value) ? trim((string) $value) : '';
    if ($required && $v === '') throw new HttpError(400, "Enter the $label.");
    if (char_length($v) > $max) throw new HttpError(400, "The $label is too long (max $max characters).");
    return $v;
}

function v_one_of(mixed $value, array $options, string $label): string
{
    if (!is_string($value) || !in_array($value, $options, true)) throw new HttpError(400, "Choose a valid $label.");
    return $value;
}

function v_date(mixed $value, string $label, bool $required = true, bool $notFuture = false): ?string
{
    $v = is_string($value) ? trim($value) : '';
    if ($v === '' && !$required) return null;
    $d = DateTime::createFromFormat('!Y-m-d', $v);
    if (!$d || $d->format('Y-m-d') !== $v) throw new HttpError(400, "Enter a valid $label.");
    if ($notFuture && $v > today()) throw new HttpError(400, "The $label can’t be in the future.");
    return $v;
}

function v_time(mixed $value): string
{
    $v = is_string($value) ? trim($value) : '';
    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) throw new HttpError(400, 'Enter a valid time.');
    return $v;
}

function v_number(mixed $value, string $label, array $range, bool $required = false, bool $integer = false): int|float|null
{
    if ($value === null || $value === '') {
        if ($required) throw new HttpError(400, "Enter the $label.");
        return null;
    }
    [$min, $max] = $range;
    $ok = is_numeric($value) && $value >= $min && $value <= $max && (!$integer || floor((float) $value) == $value);
    if (!$ok) {
        $what = $integer ? 'a whole number ' : '';
        throw new HttpError(400, "The $label must be {$what}between " . js_number($min) . ' and ' . js_number($max) . '.');
    }
    return $integer ? (int) $value : (float) $value;
}
