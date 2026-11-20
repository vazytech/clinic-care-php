<?php
// Approving or rejecting account requests made through sign-up.

declare(strict_types=1);

function pending_user(string $id): array
{
    $user = q("SELECT id, username FROM users WHERE id = ? AND status = 'pending' FOR UPDATE", [(int) $id])->fetch();
    if (!$user) throw new HttpError(404, 'That account request could not be found. It may already have been handled.');
    return $user;
}

function route_user_approve(array $admin, string $id): array
{
    require_perm($admin, 'team.manage');
    $role = v_one_of(input('role'), array_keys(ROLES), 'role');
    tx(function () use ($admin, $id, $role) {
        $user = pending_user($id);
        q("UPDATE users SET status = 'active', active = 1, role = ? WHERE id = ?", [$role, $user['id']]);
        audit($admin['id'], 'user.approve', 'user', $user['username'], ['role' => $role]);
    });
    return ['ok' => true];
}

function route_user_reject(array $admin, string $id): array
{
    require_perm($admin, 'team.manage');
    tx(function () use ($admin, $id) {
        $user = pending_user($id);
        // Kept (not deleted) so the audit trail still makes sense; the username stays taken.
        q("UPDATE users SET status = 'rejected', active = 0 WHERE id = ?", [$user['id']]);
        audit($admin['id'], 'user.reject', 'user', $user['username']);
    });
    return ['ok' => true];
}
