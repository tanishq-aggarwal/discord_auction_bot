export type CommandAccess = "public" | "server-admin" | "auction-admin";

export type CommandRouteSpec = {
    name: string;
    access: CommandAccess;
    mutates: boolean;
};

export const COMMAND_ROUTE_SPECS = [
    { name: "set-admin-role", access: "server-admin", mutates: true },
    { name: "create", access: "auction-admin", mutates: true },
    { name: "delete", access: "auction-admin", mutates: true },
    { name: "add-slave", access: "auction-admin", mutates: true },
    { name: "update-slave-specialty", access: "auction-admin", mutates: true },
    { name: "add-master", access: "auction-admin", mutates: true },
    { name: "remove-slave", access: "auction-admin", mutates: true },
    { name: "remove-master", access: "auction-admin", mutates: true },
    { name: "start", access: "auction-admin", mutates: true },
    { name: "reset", access: "auction-admin", mutates: true },
    { name: "start-next-round", access: "auction-admin", mutates: true },
    { name: "start-next-random-round", access: "auction-admin", mutates: true },
    { name: "cancel-current-round", access: "auction-admin", mutates: true },
    { name: "undo-last-round", access: "auction-admin", mutates: true },
    { name: "view-status", access: "public", mutates: false },
    { name: "view-participants", access: "public", mutates: false },
] as const satisfies readonly CommandRouteSpec[];

export function getCommandRouteSpec(name: string): CommandRouteSpec | undefined {
    return COMMAND_ROUTE_SPECS.find((route) => route.name === name);
}
