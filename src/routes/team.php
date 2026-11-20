<?php
// Duty roster: weekly days and "away today".

declare(strict_types=1);

function route_team_update(array $user, string $id): array
{
    require_perm($user, 'team.manage');
    $role = v_text(input('role'), 'role', true, 120);
    $days = input('days');
    if (!is_array($days)) throw new HttpError(400, 'Choose valid working days.');
    $days = array_values(array_unique(array_map(fn ($d) => is_numeric($d) ? (int) $d : -1, $days)));
    foreach ($days as $d) {
        if ($d < 0 || $d > 6) throw new HttpError(400, 'Choose valid working days.');
    }
    sort($days);
    tx(function () use ($id, $role, $days, $user) {
        if (!q('SELECT 1 FROM team_members WHERE id = ?', [(int) $id])->fetch()) throw new HttpError(404, 'That team member could not be found.');
        q('UPDATE team_members SET role = ?, days = ? WHERE id = ?', [$role, implode(',', $days), (int) $id]);
        audit($user['id'], 'team.roster', 'team_member', $id, compact('role', 'days'));
    });
    return ['ok' => true];
}

function route_team_away(array $user, string $id): array
{
    require_perm($user, 'team.manage');
    $away = input('away') === true;
    tx(function () use ($id, $away, $user) {
        if (!q('SELECT 1 FROM team_members WHERE id = ?', [(int) $id])->fetch()) throw new HttpError(404, 'That team member could not be found.');
        if ($away) q('INSERT IGNORE INTO team_away (member_id, date) VALUES (?, ?)', [(int) $id, today()]);
        else q('DELETE FROM team_away WHERE member_id = ? AND date = ?', [(int) $id, today()]);
        audit($user['id'], $away ? 'team.away' : 'team.back', 'team_member', $id);
    });
    return ['ok' => true];
}
