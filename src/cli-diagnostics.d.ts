export interface ValidateOptions {
    strict: boolean;
}
/**
 * Validate the current project configuration.
 */
export declare function validate(options: ValidateOptions): Promise<void>;
export interface DoctorOptions {
    fix: boolean;
}
/**
 * Run diagnostics and health checks.
 */
export declare function doctor(options: DoctorOptions): Promise<void>;
